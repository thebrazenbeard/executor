import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

async function waitForServer(child: ReturnType<typeof spawn>) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 8000);
    let output = "";
    child.stdout?.on("data", chunk => {
      output += chunk.toString();
      if (output.includes('"role":"device"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", code => reject(new Error("server exited before listening: " + code)));
  });
}

async function attach(url: string, deviceId: string, token: string) {
  const ws = new WebSocket(url);
  return await new Promise<{ ws: WebSocket; ready: boolean; closeCode?: number }>((resolve, reject) => {
    ws.once("open", () => ws.send(JSON.stringify({ type: "hello", deviceId, token, initializeResult: {} })));
    ws.on("message", raw => {
      if (JSON.parse(raw.toString()).type === "ready") resolve({ ws, ready: true });
    });
    ws.once("close", code => resolve({ ws, ready: false, closeCode: code }));
    ws.once("error", reject);
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("credential revocation timeout")), timeoutMs);
    ws.once("close", code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

test("active file-backed device sessions revoke on rotation, deletion and invalid store without replay", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "executor-live-revocation-"));
  const credentials = path.join(dir, "devices.json");
  let writeCounter = 0;
  const replaceCredentials = async (value: string) => {
    const temp = path.join(dir, "tokens-" + (++writeCounter) + ".json");
    await writeFile(temp, value);
    await rename(temp, credentials);
  };
  await replaceCredentials(JSON.stringify({ alpha: "old-alpha", beta: "beta-secret" }));

  const mcpPort = 29000 + Math.floor(Math.random() * 500);
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

  let credentialErrorLog = "";
  child.stderr?.on("data", chunk => { credentialErrorLog += chunk.toString(); });
  const wsUrl = "ws://127.0.0.1:" + devicePort + "/device";
  const mcpUrl = "http://127.0.0.1:" + mcpPort;
  try {
    await waitForServer(child);
    const alpha = await attach(wsUrl, "alpha", "old-alpha");
    const beta = await attach(wsUrl, "beta", "beta-secret");
    assert.equal(alpha.ready, true);
    assert.equal(beta.ready, true);

    const firstClose = waitForClose(alpha.ws);
    await replaceCredentials(JSON.stringify({ alpha: "new-alpha", beta: "beta-secret" }));
    assert.equal(await firstClose, 4005, "rotation must disconnect the already-authenticated socket");
    assert.equal(beta.ws.readyState, WebSocket.OPEN, "unaffected device must remain connected");

    const stale = await attach(wsUrl, "alpha", "old-alpha");
    assert.equal(stale.ready, false);
    assert.equal(stale.closeCode, 4004);
    const refreshed = await attach(wsUrl, "alpha", "new-alpha");
    assert.equal(refreshed.ready, true);

    const received = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("effect not dispatched")), 4000);
      refreshed.ws.on("message", raw => {
        if (JSON.parse(raw.toString()).type === "request") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const rpc = fetch(mcpUrl + "/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer client-test",
        "content-type": "application/json",
        "x-executor-device": "alpha"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 88, method: "tools/list" })
    });
    await received;

    const deletedClose = waitForClose(refreshed.ws);
    await replaceCredentials(JSON.stringify({ beta: "beta-secret" }));
    assert.equal(await deletedClose, 4005);
    const response = await rpc;
    assert.equal(response.status, 502, "in-flight RPC must reject after credential removal");
    const effectResponse = await fetch(mcpUrl + "/effects", {
      headers: { authorization: "Bearer client-test" }
    });
    const ledger = await effectResponse.json() as { effects: Array<{ deviceId: string; disposition: string }> };
    assert.ok(ledger.effects.some(effect => effect.deviceId === "alpha" && effect.disposition === "OUTCOME_UNKNOWN"),
      "a dispatched effect is not silently retried or falsely classified as never sent");
    assert.equal(beta.ws.readyState, WebSocket.OPEN);

    const storeFailureClose = waitForClose(beta.ws);
    await replaceCredentials('{"alpha":unquoted-should-never-appear-777}');
    assert.equal(await storeFailureClose, 4005, "malformed credential source must fail closed");
    const health = await fetch(mcpUrl + "/health", {
      headers: { authorization: "Bearer client-test" }
    });
    const state = await health.json() as { connectedDeviceCount: number };
    assert.equal(state.connectedDeviceCount, 0);
    assert.match(credentialErrorLog, /device-credential-store-error/,
      "the fail-closed parser diagnostic must actually be observed");
    assert.doesNotMatch(credentialErrorLog, /unquoted|should-never|appear-777/,
      "even truncated malformed credential bytes must not appear in service logs");
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
