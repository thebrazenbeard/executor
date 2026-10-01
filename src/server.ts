import http from "node:http";
import { WebSocketServer } from "ws";
import { bearerAuthorized, tokenAuthorized } from "./auth.js";
import { DeviceConnection, DeviceEffectError, DeviceRegistry } from "./device-registry.js";
import { WorkContextOrchestrator } from "./orchestrator.js";
import type { DeviceHello, DeviceResponse, JsonRpc } from "./protocol.js";
import { isJsonRpc, isNotification } from "./protocol.js";
import { capacityConfig, qualificationStatus } from "./config.js";
import { isOriginAllowed } from "./security.js";
import { ResourceKeyGate } from "./resource-gate.js";
import { JsonlExecutionEventStore } from "./execution-store.js";
import { EffectLedger } from "./effect-ledger.js";
import { randomUUID } from "node:crypto";
import { augmentToolsList, executorListDevicesTool, extractDeviceId, stripDeviceId } from "./tool-routing.js";

const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST ?? "0.0.0.0";
const clientToken = process.env.EXECUTOR_CLIENT_TOKEN ?? "";
const deviceToken = process.env.EXECUTOR_DEVICE_TOKEN ?? "";
const defaultDevice = process.env.EXECUTOR_DEFAULT_DEVICE ?? "";
const capacity = capacityConfig();
const qualification = qualificationStatus(capacity);
const allowedOrigins = (process.env.EXECUTOR_ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean);

if (!clientToken || !deviceToken) throw new Error("EXECUTOR_CLIENT_TOKEN and EXECUTOR_DEVICE_TOKEN are required");

const registry = new DeviceRegistry();
const eventStore = process.env.EXECUTOR_EXECUTION_EVENT_FILE ? new JsonlExecutionEventStore(process.env.EXECUTOR_EXECUTION_EVENT_FILE) : undefined;
const logic = new WorkContextOrchestrator(capacity.upstreamContexts, eventStore);
const resourceGate = new ResourceKeyGate();
const effects = new EffectLedger();

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data), "cache-control": "no-store" });
  res.end(data);
}

function rpcError(id: JsonRpc["id"], code: number, message: string): JsonRpc {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function localInitializeResponse(payload: JsonRpc, device?: DeviceConnection): JsonRpc {
  const downstream = device?.initializeResult ?? {};
  const requested = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? (payload.params as Record<string, unknown>).protocolVersion
    : undefined;
  const protocolVersion = typeof downstream.protocolVersion === "string"
    ? downstream.protocolVersion
    : (typeof requested === "string" ? requested : "2025-06-18");
  const capabilities = downstream.capabilities && typeof downstream.capabilities === "object"
    ? downstream.capabilities
    : {};
  return {
    jsonrpc: "2.0",
    id: payload.id ?? null,
    result: {
      ...downstream,
      protocolVersion,
      capabilities,
      serverInfo: { name: "executor", version: "0.1.0" }
    }
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/effects") {
    if (!bearerAuthorized(req.headers.authorization, clientToken)) return json(res, 401, { error: "unauthorized" });
    return json(res, 200, { effects: effects.recent() });
  }

  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, {
      status: "ok",
      connectedDeviceCount: registry.list().length,
      executionCapacityPerDevice: capacity.executionPerDevice,
      upstreamContextCapacity: capacity.upstreamContexts,
      qualification,
      upstreamContextActive: logic.activeCount,
      upstreamContextQueued: logic.queuedCount,
      executionActive: registry.list().reduce((sum, id) => sum + (registry.get(id)?.activeCount ?? 0), 0),
      executionQueued: registry.list().reduce((sum, id) => sum + (registry.get(id)?.queuedCount ?? 0), 0),
      devices: registry.list().map(id => registry.describe(id))
    });
  }

  if (req.url === "/mcp" && !isOriginAllowed(req.headers.origin, allowedOrigins)) return json(res, 403, { error: "origin not allowed" });
  if (req.url === "/mcp" && req.method !== "POST") {
    res.writeHead(405, { allow: "POST", "cache-control": "no-store" });
    return res.end();
  }
  if (req.url !== "/mcp") return json(res, 404, { error: "not found" });
  if (!bearerAuthorized(req.headers.authorization, clientToken)) return json(res, 401, { error: "unauthorized" });

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > 2_000_000) return json(res, 413, { error: "request too large" });
    chunks.push(b);
  }

  let payload: unknown;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return json(res, 400, { error: "invalid json" }); }
  if (!isJsonRpc(payload)) return json(res, 400, { error: "invalid json-rpc" });

  const requested = req.headers["x-executor-device"];
  const headerDeviceId = Array.isArray(requested) ? requested[0] : requested;
  if (headerDeviceId && (headerDeviceId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(headerDeviceId))) {
    return json(res, 400, rpcError(payload.id, -32602, "invalid workstation id"));
  }

  if (payload.method === "initialize" && payload.id !== undefined) {
    const initializeDeviceId = headerDeviceId
      || (defaultDevice && registry.get(defaultDevice) ? defaultDevice : undefined)
      || registry.list()[0];
    return json(res, 200, localInitializeResponse(payload, initializeDeviceId ? registry.get(initializeDeviceId) : undefined));
  }
  if (payload.method === "notifications/initialized" && payload.id === undefined) {
    res.writeHead(202, { "cache-control": "no-store" });
    return res.end();
  }
  if (payload.method === "ping" && payload.id !== undefined) {
    return json(res, 200, { jsonrpc: "2.0", id: payload.id ?? null, result: {} });
  }

  const toolName = payload.method === "tools/call"
    && payload.params
    && typeof payload.params === "object"
    && !Array.isArray(payload.params)
    && typeof (payload.params as Record<string, unknown>).name === "string"
      ? (payload.params as Record<string, unknown>).name as string
      : undefined;

  if (toolName === executorListDevicesTool.name && payload.id !== undefined) {
    const devices = registry.list().map(id => {
      const attachment = registry.describe(id);
      const connection = registry.get(id);
      return {
        ...attachment,
        executionActive: connection?.activeCount ?? 0,
        executionQueued: connection?.queuedCount ?? 0
      };
    });
    return json(res, 200, {
      jsonrpc: "2.0",
      id: payload.id ?? null,
      result: {
        content: [{ type: "text", text: JSON.stringify(devices) }],
        structuredContent: { devices }
      }
    });
  }

  if (payload.method === "tools/list" && payload.id !== undefined && registry.list().length === 0) {
    return json(res, 200, augmentToolsList({
      jsonrpc: "2.0",
      id: payload.id ?? null,
      result: { tools: [] }
    }));
  }

  const routedDeviceId = extractDeviceId(payload);
  const deviceId = routedDeviceId
    || headerDeviceId
    || (defaultDevice && registry.get(defaultDevice) ? defaultDevice : undefined)
    || registry.list()[0]
    || defaultDevice;
  if (deviceId && (deviceId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(deviceId))) return json(res, 400, rpcError(payload.id, -32602, "invalid workstation id"));
  if (!deviceId) return json(res, 503, rpcError(payload.id, -32001, "no workstation connected"));
  const resolved = registry.resolve(deviceId);
  if (!resolved) return json(res, 404, rpcError(payload.id, -32002, "requested workstation is not connected"));
  const { device, generation } = resolved;
  const downstreamPayload = stripDeviceId(payload);

  try {
    const parentHeader = req.headers["x-executor-parent-execution"];
    const parentExecutionId = Array.isArray(parentHeader) ? parentHeader[0] : parentHeader;
    if (parentExecutionId && (parentExecutionId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(parentExecutionId))) return json(res, 400, rpcError(payload.id, -32602, "invalid parent execution id"));
    const resourceHeader = req.headers["x-executor-resource-key"];
    const resourceKey = Array.isArray(resourceHeader) ? resourceHeader[0] : resourceHeader;
    if (resourceKey && (resourceKey.length > 256 || !/^[A-Za-z0-9._:/-]+$/.test(resourceKey))) return json(res, 400, rpcError(payload.id, -32602, "invalid resource key"));
    const lane = logic.create(parentExecutionId);
    logic.bindEffect(lane.id, deviceId);
    const effectId = randomUUID();
    effects.create(effectId, deviceId, generation, false);
    const dispatch = <T>(work: (device: DeviceConnection) => Promise<T>) => {
      effects.transition(effectId, "ADMITTED");
      const execute = async () => {
        const current = registry.getIfGeneration(deviceId, generation);
        if (!current) {
          effects.transition(effectId, "FAILED");
          throw new Error("workstation connection changed before effect dispatch");
        }
        effects.transition(effectId, "DISPATCHED");
        try {
          const value = await work(current);
          effects.transition(effectId, "COMPLETED");
          return value;
        } catch (error) {
          effects.transition(effectId, error instanceof DeviceEffectError && error.disposition === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED");
          throw error;
        }
      };
      return resourceKey ? resourceGate.run(resourceKey, execute) : execute();
    };
    if (isNotification(payload)) {
      await logic.run(lane.id, () => dispatch(device => device.notify(downstreamPayload)));
      res.writeHead(202, { "cache-control": "no-store" });
      return res.end();
    }
    const response = await logic.run(lane.id, () => dispatch(device => device.request(downstreamPayload)));
    return json(res, 200, payload.method === "tools/list" ? augmentToolsList(response) : response);
  } catch (error) {
    return json(res, 502, rpcError(payload.id, -32003, error instanceof Error ? error.message : "device bridge failed"));
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/device") return socket.destroy();
  if (!isOriginAllowed(req.headers.origin, allowedOrigins)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});

wss.on("connection", ws => {
  let device: DeviceConnection | undefined;
  ws.on("error", error => console.error(JSON.stringify({ status: "device-socket-error", message: error.message })));
  let alive = true;
  ws.on("pong", () => { alive = true; });
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);
  const helloTimer = setTimeout(() => ws.close(4000, "hello timeout"), 10_000);

  ws.on("message", raw => {
    let message: unknown;
    try { message = JSON.parse(raw.toString()); } catch { ws.close(4002, "invalid json"); return; }
    if (!device) {
      const hello = message as Partial<DeviceHello>;
      if (hello.type !== "hello" || typeof hello.deviceId !== "string" || typeof hello.token !== "string") return ws.close(4003, "hello required");
      if (hello.deviceId.length < 1 || hello.deviceId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(hello.deviceId)) return ws.close(4003, "invalid device id");
      if (!tokenAuthorized(hello.token, deviceToken)) return ws.close(4004, "unauthorized");
      clearTimeout(helloTimer);
      const initializeResult = hello.initializeResult && typeof hello.initializeResult === "object" && !Array.isArray(hello.initializeResult)
        ? hello.initializeResult
        : {};
      device = new DeviceConnection(hello.deviceId, ws, capacity.executionPerDevice, initializeResult);
      registry.attach(device);
      ws.send(JSON.stringify({ type: "ready", deviceId: device.id }));
      return;
    }
    const response = message as Partial<DeviceResponse>;
    if (response.type === "response" && typeof response.requestId === "string" && isJsonRpc(response.payload)) device.accept(response as DeviceResponse);
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(helloTimer);
    if (device) registry.detach(device);
  });
});

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(JSON.stringify({ status: "listening", host, port: boundPort, capacity, qualification }));
});
