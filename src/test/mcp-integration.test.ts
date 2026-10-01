import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("official MCP client initializes through Executor and forwards workstation tools", { timeout: 30_000 }, async () => {
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
        result = { tools: [{ name: "echo", description: "fake", inputSchema: { type: "object", properties: {} } }] };
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
    assert.equal(listed.tools.some(t => t.name === "echo"), true);
    assert.equal(forwardedMethods.includes("initialize"), false);
    assert.equal(forwardedMethods.includes("notifications/initialized"), false);
    assert.equal(forwardedMethods.filter(m => m === "tools/list").length, 1);

    const badDevice = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-test",
        "content-type": "application/json",
        "x-executor-device": "../bad device"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/list", params: {} })
    });
    assert.equal(badDevice.status, 400);
  } finally {
    await client.close().catch(() => {});
    ws.close();
    child.kill();
  }
});
