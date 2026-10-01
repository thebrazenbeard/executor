import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";

test("Synology hello metadata is retained and its two-lane ceiling is enforced", { timeout: 30_000 }, async () => {
  const port = 24787 + Math.floor(Math.random() * 500);
  const devicePort = port + 1000;
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      EXECUTOR_DEVICE_HOST: "127.0.0.1",
      EXECUTOR_DEVICE_PORT: String(devicePort),
      EXECUTOR_CLIENT_TOKEN: "client-synology",
      EXECUTOR_DEVICE_TOKEN: "device-synology",
      EXECUTOR_EXECUTION_CAPACITY: "8",
      EXECUTOR_LOGIC_CAPACITY: "64"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 8000);
    child.stdout.on("data", chunk => {
      if (chunk.toString().includes('"role":"device"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", code => reject(new Error("server exited early: " + code)));
  });

  const ws = new WebSocket(`ws://127.0.0.1:${devicePort}/device`);
  const requests: any[] = [];
  let ready: any;

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => ws.send(JSON.stringify({
      type: "hello",
      deviceId: "DS216",
      token: "device-synology",
      deviceProfile: {
        kind: "synology-storage",
        platform: "linux",
        arch: "armv7",
        packageArch: "armada38x",
        nodeVersion: "0.1.0",
        executionCapacity: 2
      },
      initializeResult: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "executor-node", version: "0.1.0" }
      }
    })));

    ws.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "ready") {
        ready = message;
        resolve();
        return;
      }
      if (message.type === "request") requests.push(message);
    });
    ws.once("error", reject);
  });

  try {
    assert.equal(ready.generation, 1);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: "Bearer client-synology" }
    });
    const health = await healthResponse.json() as any;
    assert.equal(health.devices[0].deviceId, "DS216");
    assert.equal(health.devices[0].executionCapacity, 2);
    assert.deepEqual(health.devices[0].deviceProfile, {
      kind: "synology-storage",
      platform: "linux",
      arch: "armv7",
      packageArch: "armada38x",
      nodeVersion: "0.1.0",
      executionCapacity: 2
    });

    const listResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-synology",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "list_devices", arguments: {} }
      })
    });
    const listed = await listResponse.json() as any;
    assert.equal(listed.result.structuredContent.devices[0].deviceProfile.kind, "synology-storage");

    const invoke = (id: number) => fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-synology",
        "content-type": "application/json",
        "x-executor-device": "DS216"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "storage.stat", arguments: { rootId: "test", path: String(id) } }
      })
    }).then(response => response.json());

    const pending = [invoke(21), invoke(22), invoke(23)];
    for (let spin = 0; requests.length < 2 && spin < 100; spin++) await new Promise(r => setTimeout(r, 5));
    assert.equal(requests.length, 2, "only two Synology requests should dispatch concurrently");
    await new Promise(r => setTimeout(r, 50));
    assert.equal(requests.length, 2, "third request must remain queued while both device lanes are active");

    for (const message of requests.slice(0, 2)) {
      ws.send(JSON.stringify({
        type: "response",
        requestId: message.requestId,
        payload: { jsonrpc: "2.0", id: message.payload.id, result: { content: [] } }
      }));
    }

    for (let spin = 0; requests.length < 3 && spin < 100; spin++) await new Promise(r => setTimeout(r, 5));
    assert.equal(requests.length, 3, "third request should dispatch after a device lane is released");
    const third = requests[2];
    ws.send(JSON.stringify({
      type: "response",
      requestId: third.requestId,
      payload: { jsonrpc: "2.0", id: third.payload.id, result: { content: [] } }
    }));
    await Promise.all(pending);
  } finally {
    ws.close();
    child.kill();
  }
});
