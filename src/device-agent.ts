import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import type { DeviceRequest, JsonRpc } from "./protocol.js";
import { assertSafeDeviceServiceUrl, resolveInsideRoot, trustedSha256Matches } from "./security.js";
import { payloadEnvironment } from "./payload-env.js";

const serviceUrl = process.env.EXECUTOR_SERVICE_URL ?? "";
const token = process.env.EXECUTOR_DEVICE_TOKEN ?? "";
const deviceId = process.env.EXECUTOR_DEVICE_ID ?? "";
const trustedManifestHash = process.env.EXECUTOR_TRUSTED_MANIFEST_SHA256 ?? "";
const deviceCaFile = process.env.EXECUTOR_DEVICE_CA_FILE?.trim() ?? "";
const tlsServerName = process.env.EXECUTOR_DEVICE_TLS_SERVER_NAME?.trim() ?? "";
const installRoot = process.env.EXECUTOR_INSTALL_ROOT ?? (process.platform === "win32"
  ? "C:\\ProgramData\\Executor\\DesktopCommanderMCP"
  : "/opt/executor/DesktopCommanderMCP");

if (!serviceUrl || !token || !deviceId || !trustedManifestHash) throw new Error("EXECUTOR_SERVICE_URL, EXECUTOR_DEVICE_TOKEN, EXECUTOR_DEVICE_ID and EXECUTOR_TRUSTED_MANIFEST_SHA256 are required");

const deviceCa = deviceCaFile ? await readFile(deviceCaFile) : undefined;
const manifestPath = path.join(installRoot, "executor-desktop-commander.manifest.json");
const rawManifest = await readFile(manifestPath, "utf8");
const manifestText = rawManifest.charCodeAt(0) === 0xfeff ? rawManifest.slice(1) : rawManifest;
const manifest = JSON.parse(manifestText) as {
  schema: string;
  upstream_commit: string;
  upstream_version: string;
  node_executable_relative: string;
  node_sha256: string;
  entrypoint_relative: string;
  entrypoint_sha256: string;
  mcp_args: string[];
};

if (manifest.schema !== "EXECUTOR_DESKTOP_COMMANDER_PAYLOAD_V1") throw new Error("unsupported Executor duplicate manifest schema");
if (manifest.upstream_commit !== "550a0b3e31da18b7cf25e87ed840e3d953b6da42") throw new Error("unqualified Desktop Commander upstream commit");
if (manifest.upstream_version !== "0.2.51") throw new Error("unqualified Desktop Commander upstream version");

async function sha256(file: string) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

if (!trustedSha256Matches(await sha256(manifestPath), trustedManifestHash)) throw new Error("Executor manifest trust-anchor hash mismatch");

const nodeExe = resolveInsideRoot(installRoot, manifest.node_executable_relative);
const entrypoint = resolveInsideRoot(installRoot, manifest.entrypoint_relative);
if (await sha256(nodeExe) !== manifest.node_sha256.toLowerCase()) throw new Error("packaged Node hash mismatch");
if (await sha256(entrypoint) !== manifest.entrypoint_sha256.toLowerCase()) throw new Error("Desktop Commander entrypoint hash mismatch");
if (!manifest.mcp_args.length || path.normalize(manifest.mcp_args[0]) !== path.normalize(manifest.entrypoint_relative)) throw new Error("manifest mcp_args do not bind the qualified entrypoint");

console.error(JSON.stringify({ status: "qualified-payload-spawn-start" }));
const child = spawn(nodeExe, manifest.mcp_args, {
  cwd: installRoot,
  stdio: ["pipe", "pipe", "inherit"],
  env: payloadEnvironment(process.env),
  windowsHide: true
});

const LF = String.fromCharCode(10);
let buffer = "";
let localId = 1;
let ws: WebSocket | undefined;
let reconnectAttempt = 0;
let stopped = false;

const pendingOutbound = new Map<string | number, { requestId: string; originalId: JsonRpc["id"] }>();
const pendingInternal = new Map<string | number, {
  resolve: (value: JsonRpc) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}>();

function writeChild(payload: JsonRpc, timeoutMs = 30_000): Promise<JsonRpc> {
  return new Promise((resolve, reject) => {
    const id = localId++;
    const timer = setTimeout(() => {
      pendingInternal.delete(id);
      reject(new Error("qualified payload request timed out"));
    }, timeoutMs);
    pendingInternal.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ ...payload, id }) + LF, error => {
      if (!error) return;
      clearTimeout(timer);
      pendingInternal.delete(id);
      reject(error);
    });
  });
}

function notifyChild(payload: JsonRpc): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdin.write(JSON.stringify(payload) + LF, error => error ? reject(error) : resolve());
  });
}

child.stdout.on("data", chunk => {
  buffer += chunk.toString();
  const lines = buffer.split(LF);
  buffer = lines.pop() ?? "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let payload: JsonRpc;
    try { payload = JSON.parse(line); } catch { continue; }
    if (payload.id === undefined) continue;

    const internal = pendingInternal.get(payload.id as string | number);
    if (internal) {
      clearTimeout(internal.timer);
      pendingInternal.delete(payload.id as string | number);
      internal.resolve(payload);
      continue;
    }

    const marker = pendingOutbound.get(payload.id as string | number);
    if (!marker) continue;
    pendingOutbound.delete(payload.id as string | number);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "response", requestId: marker.requestId, payload: { ...payload, id: marker.originalId } }));
    }
  }
});

child.on("exit", code => {
  stopped = true;
  for (const pending of pendingInternal.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Desktop Commander exited during internal request"));
  }
  pendingInternal.clear();
  if (ws?.readyState === WebSocket.OPEN) ws.close(1011, "desktop commander exited");
  console.error(JSON.stringify({ status: "desktop-commander-exited", code }));
  process.exit(code ?? 1);
});

const initResponse = await writeChild({
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "executor-device-agent", version: "0.1.0" }
  }
}, 60_000);

if (initResponse.error) throw new Error(`Desktop Commander initialize failed: ${initResponse.error.message}`);
if (!initResponse.result || typeof initResponse.result !== "object" || Array.isArray(initResponse.result)) {
  throw new Error("Desktop Commander initialize returned invalid result");
}
const downstreamInitializeResult = initResponse.result as Record<string, unknown>;
console.error(JSON.stringify({ status: "qualified-payload-initialized" }));
await notifyChild({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

function connect() {
  const url = new URL(serviceUrl);
  assertSafeDeviceServiceUrl(url);
  url.pathname = "/device";
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const tlsPort = url.port || (url.protocol === "wss:" ? "443" : "");
  const tlsHostHeader = tlsServerName
    ? tlsServerName + (tlsPort && tlsPort !== "443" ? `:${tlsPort}` : "")
    : "";
  console.error(JSON.stringify({ status: "device-websocket-connect-attempt", transport: url.protocol }));
  const socket = new WebSocket(url, {
    maxPayload: 2_000_000,
    handshakeTimeout: 10_000,
    ...(deviceCa ? { ca: deviceCa } : {}),
    ...(tlsServerName && url.protocol === "wss:"
      ? { servername: tlsServerName, headers: { Host: tlsHostHeader } }
      : {})
  });
  ws = socket;

  socket.on("open", () => {
    console.error(JSON.stringify({ status: "device-websocket-open" }));
    reconnectAttempt = 0;
    socket.send(JSON.stringify({
      type: "hello",
      deviceId,
      token,
      initializeResult: downstreamInitializeResult
    }));
  });

  socket.on("message", raw => {
    let message: Partial<DeviceRequest> & { type?: string };
    try { message = JSON.parse(raw.toString()); } catch { socket.close(4002, "invalid json"); return; }
    if (message.type === "ready") {
      console.error(JSON.stringify({ status: "device-websocket-ready" }));
      return;
    }
    if (message.type !== "request" || typeof message.requestId !== "string" || !message.payload) return;
    if (message.payload.id === undefined) {
      child.stdin.write(JSON.stringify(message.payload) + LF, error => {
        if (error) console.error(JSON.stringify({ status: "notification-write-failed", requestId: message.requestId, message: error.message }));
      });
      return;
    }
    const bridgeId = localId++;
    const originalId = message.payload.id;
    pendingOutbound.set(bridgeId, { requestId: message.requestId, originalId });
    child.stdin.write(JSON.stringify({ ...message.payload, id: bridgeId }) + LF, error => {
      if (!error) return;
      pendingOutbound.delete(bridgeId);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "response",
          requestId: message.requestId,
          payload: {
            jsonrpc: "2.0",
            id: originalId ?? null,
            error: { code: -32004, message: "qualified payload stdin write failed" }
          }
        }));
      }
    });
  });

  socket.on("error", error => console.error(JSON.stringify({ status: "device-websocket-error", message: error.message })));
  socket.on("close", (code, reason) => {
    console.error(JSON.stringify({
      status: "device-websocket-closed",
      code,
      reason: reason.toString()
    }));
    if (stopped) return;
    for (const marker of pendingOutbound.values()) {
      console.error(JSON.stringify({ status: "request-outcome-unknown-after-disconnect", requestId: marker.requestId }));
    }
    pendingOutbound.clear();
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(reconnectAttempt++, 5)));
    setTimeout(connect, delay);
  });
}

connect();
