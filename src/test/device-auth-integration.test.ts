import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";

test("Executor can run map-only device credentials and binds each token to its device ID", { timeout: 20_000 }, async () => {
  const port = 22787 + Math.floor(Math.random() * 500);
  const devicePort = port + 1000;
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      EXECUTOR_DEVICE_HOST: "127.0.0.1",
      EXECUTOR_DEVICE_PORT: String(devicePort),
      EXECUTOR_CLIENT_TOKEN: "client-test",
      EXECUTOR_DEVICE_TOKEN: "",
      EXECUTOR_DEVICE_TOKENS_JSON: JSON.stringify({
        alpha: "alpha-secret",
        beta: "beta-secret"
      })
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

  async function connect(deviceId: string, token: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${devicePort}/device`);
    return await new Promise<{ ws: WebSocket; ready: boolean; closeCode?: number }>((resolve, reject) => {
      ws.once("open", () => ws.send(JSON.stringify({
        type: "hello",
        deviceId,
        token,
        initializeResult: {}
      })));
      ws.on("message", raw => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ready") resolve({ ws, ready: true });
      });
      ws.once("close", code => resolve({ ws, ready: false, closeCode: code }));
      ws.once("error", reject);
    });
  }

  try {
    const wrong = await connect("alpha", "beta-secret");
    assert.equal(wrong.ready, false);
    assert.equal(wrong.closeCode, 4004);

    const alpha = await connect("alpha", "alpha-secret");
    assert.equal(alpha.ready, true);
    alpha.ws.close();

    const beta = await connect("beta", "beta-secret");
    assert.equal(beta.ready, true);
    beta.ws.close();
  } finally {
    child.kill();
  }
});
