import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("Executor exposes RDC-style device routing while preserving downstream tool semantics", { timeout: 30_000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      EXECUTOR_CLIENT_TOKEN: "client-test",
      EXECUTOR_DEVICE_TOKEN: "device-test",
      EXECUTOR_DEFAULT_DEVICE: "fake"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 8000);
    child.stdout.on("data", chunk => {
      if (chunk.toString().includes('"status":"listening"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", code => reject(new Error("server exited early: " + code)));
  });

  const forwardedMethods: string[] = [];
  const forwardedToolArguments: Record<string, unknown>[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/device`);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => ws.send(JSON.stringify({
      type: "hello",
      deviceId: "fake",
      token: "device-test",
      initializeResult: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-executor-device", version: "1.0.0" }
      }
    })));

    ws.on("message", raw => {
      const m = JSON.parse(raw.toString());
      if (m.type === "ready") return resolve();
      if (m.type !== "request") return;

      const p = m.payload;
      if (typeof p.method === "string") forwardedMethods.push(p.method);
      let result: unknown = {};

      if (p.method === "tools/list") {
        result = {
          tools: [{
            name: "echo",
            description: "fake",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"]
            }
          }]
        };
      }

      if (p.method === "tools/call") {
        const args = p.params?.arguments ?? {};
        forwardedToolArguments.push(args);
        result = { content: [{ type: "text", text: JSON.stringify(args) }] };
      }

      if (p.id !== undefined) {
        ws.send(JSON.stringify({
          type: "response",
          requestId: m.requestId,
          payload: { jsonrpc: "2.0", id: p.id, result }
        }));
      }
    });
    ws.once("error", reject);
  });

  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: "Bearer client-test", "x-executor-device": "fake" } }
  });
  const client = new Client({ name: "executor-acceptance", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();

    const echo = listed.tools.find(t => t.name === "echo");
    assert.ok(echo);
    assert.equal((echo.inputSchema as any).properties.deviceId.type, "string");
    assert.equal(listed.tools.some(t => t.name === "list_devices"), true);

    const devicesResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-test",
        "content-type": "application/json",
        "x-executor-device": "fake"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 50,
        method: "tools/call",
        params: { name: "list_devices", arguments: {} }
      })
    });
    const devicesBody = await devicesResponse.json() as any;
    assert.equal(devicesBody.result.structuredContent.devices[0].deviceId, "fake");

    const routedResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-test",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 51,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: { message: "hello", deviceId: "fake" }
        }
      })
    });
    assert.equal(routedResponse.status, 200);
    assert.deepEqual(forwardedToolArguments.at(-1), { message: "hello" });

    const publicHealth = await fetch(`http://127.0.0.1:${port}/health`);
    const publicHealthBody = await publicHealth.json() as any;
    assert.equal(publicHealthBody.connectedDeviceCount, 1);
    assert.equal("devices" in publicHealthBody, false);

    const authorizedHealth = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: "Bearer client-test" }
    });
    const authorizedHealthBody = await authorizedHealth.json() as any;
    assert.equal(authorizedHealthBody.devices[0].deviceId, "fake");

    assert.equal(forwardedMethods.includes("initialize"), false);
    assert.equal(forwardedMethods.includes("notifications/initialized"), false);
  } finally {
    await client.close().catch(() => {});
    ws.close();
    child.kill();
  }
});


test("Executor remains connectable when no workstation is online", { timeout: 20_000 }, async () => {
  const port = 20787 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      EXECUTOR_CLIENT_TOKEN: "offline-client-test",
      EXECUTOR_DEVICE_TOKEN: "offline-device-test",
      EXECUTOR_DEFAULT_DEVICE: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 8000);
    child.stdout.on("data", chunk => {
      if (chunk.toString().includes('"status":"listening"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", code => reject(new Error("server exited early: " + code)));
  });

  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: "Bearer offline-client-test" } }
  });
  const client = new Client({ name: "executor-offline-acceptance", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(t => t.name), ["list_devices"]);

    const devices = await client.callTool({ name: "list_devices", arguments: {} });
    assert.deepEqual((devices.structuredContent as any).devices, []);
  } finally {
    await client.close().catch(() => {});
    child.kill();
  }
});
