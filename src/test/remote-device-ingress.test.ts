import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";

async function waitForListening(child: ReturnType<typeof spawn>) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 8000);
    child.stdout?.on("data", chunk => {
      if (chunk.toString().includes('"role":"device"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", code => reject(new Error("server exited early: " + code)));
  });
}

async function attach(url: string, deviceId: string, token: string) {
  const ws = new WebSocket(url);
  return await new Promise<{ ws: WebSocket; ready: boolean; closeCode?: number }>((resolve, reject) => {
    ws.once("open", () => ws.send(JSON.stringify({ type: "hello", deviceId, token, initializeResult: {} })));
    ws.on("message", raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ready") resolve({ ws, ready: true });
    });
    ws.once("close", code => resolve({ ws, ready: false, closeCode: code }));
    ws.once("error", reject);
  });
}

test("remote devices attach on a listener that does not expose MCP", { timeout: 20_000 }, async () => {
  const mcpPort = 24100 + Math.floor(Math.random() * 300);
  const devicePort = mcpPort + 1000;
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(mcpPort),
      EXECUTOR_DEVICE_HOST: "127.0.0.1",
      EXECUTOR_DEVICE_PORT: String(devicePort),
      EXECUTOR_CLIENT_TOKEN: "client-test",
      EXECUTOR_DEVICE_TOKEN: "device-test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child);
    const attached = await attach(`ws://127.0.0.1:${devicePort}/device`, "remote-alpha", "device-test");
    assert.equal(attached.ready, true);
    attached.ws.close();

    const response = await fetch(`http://127.0.0.1:${devicePort}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer client-test", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
    });
    assert.equal(response.status, 404);

    await assert.rejects(async () => {
      const legacy = await attach(`ws://127.0.0.1:${mcpPort}/device`, "legacy-alpha", "device-test");
      legacy.ws.close();
      if (legacy.ready) throw new Error("MCP listener still accepts device attachment");
    }, /MCP listener still accepts|socket hang up|ECONNRESET|Unexpected server response/);
  } finally {
    child.kill();
  }
});

test("per-device credential file can enroll a new device without server restart", { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "executor-device-tokens-"));
  const credentials = path.join(dir, "devices.json");
  await writeFile(credentials, JSON.stringify({ alpha: "alpha-secret" }));

  const mcpPort = 24500 + Math.floor(Math.random() * 300);
  const devicePort = mcpPort + 1000;
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(mcpPort),
      EXECUTOR_DEVICE_HOST: "127.0.0.1",
      EXECUTOR_DEVICE_PORT: String(devicePort),
      EXECUTOR_CLIENT_TOKEN: "client-test",
      EXECUTOR_DEVICE_TOKEN: "",
      EXECUTOR_DEVICE_TOKENS_JSON: "",
      EXECUTOR_DEVICE_TOKENS_FILE: credentials
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child);
    const alpha = await attach(`ws://127.0.0.1:${devicePort}/device`, "alpha", "alpha-secret");
    assert.equal(alpha.ready, true);
    alpha.ws.close();

    await writeFile(credentials, JSON.stringify({ alpha: "alpha-secret", beta: "beta-secret" }));
    const beta = await attach(`ws://127.0.0.1:${devicePort}/device`, "beta", "beta-secret");
    assert.equal(beta.ready, true);
    beta.ws.close();
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
