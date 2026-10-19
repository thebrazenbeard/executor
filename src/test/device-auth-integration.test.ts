import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { createServer } from "node:net";

test("Executor can run map-only device credentials and binds each token to its device ID", { timeout: 20_000 }, async () => {
  // Let the OS choose two distinct available ports, avoiding Windows exclusions
  // and fixed ranges shared with other local deployments.
  const reservations = [createServer(), createServer()];
  await Promise.all(reservations.map(server => new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  })));
  const [port, devicePort] = reservations.map(server => (server.address() as { port: number }).port);
  await Promise.all(reservations.map(server => new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()))));
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

  let startupError = "";
  child.stderr.on("data", chunk => { startupError = (startupError + chunk.toString()).slice(-4000); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 8000);
    child.stdout.on("data", chunk => {
      if (chunk.toString().includes('"role":"device"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("server exited early: " + code + " " + startupError)); });
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
