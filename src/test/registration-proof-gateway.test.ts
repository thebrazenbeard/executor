import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { classifyRegistrationReceipt } from "../registration-proof.js";

const nonce = "abcdefabcdefabcdefabcdefabcdefab";

async function messageWhen(ws: WebSocket, predicate: (item: any) => boolean, timeout = 7000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("WebSocket message timeout")); }, timeout);
    const onMessage = (raw: WebSocket.RawData) => {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(data)) { cleanup(); resolve(data); }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); ws.off("message", onMessage); ws.off("error", onError); };
    ws.on("message", onMessage);
    ws.once("error", onError);
  });
}

test("real localhost authenticated gateway registration receipt is session-specific", { timeout: 25000 }, async () => {
  const port = 31000 + Math.floor(Math.random() * 10000);
  const devicePort = port + 10000;
  const proc = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1",
      EXECUTOR_DEVICE_HOST: "127.0.0.1",
      EXECUTOR_DEVICE_PORT: String(devicePort),
      EXECUTOR_CLIENT_TOKEN: "test-client-only",
      EXECUTOR_DEVICE_TOKEN: "test-device-only" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("test gateway startup timeout")), 7000);
    proc.stdout.on("data", b => {
      if (b.toString().includes('"role":"device"')) { clearTimeout(timer); resolve(); }
    });
    proc.once("exit", code => { clearTimeout(timer); reject(new Error("test gateway exited " + code)); });
  });
  const sockets: WebSocket[] = [];
  const connect = async (id: string, token: string) => {
    const ws = new WebSocket("ws://127.0.0.1:" + devicePort + "/device");
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const ready = messageWhen(ws, m => m.type === "ready");
    ws.send(JSON.stringify({ type: "hello", deviceId: id, token, initializeResult: {} }));
    return { ws, ready: await ready };
  };
  try {
    const first = await connect("VERA-NODE-1", "test-device-only");
    assert.equal(first.ready.deviceId, "VERA-NODE-1");
    const receipt = messageWhen(first.ws, m => m.type === "registration-receipt");
    first.ws.send(JSON.stringify({ type: "registration-probe", nonce }));
    const proof = await receipt;
    assert.equal(proof.registered, true);
    assert.equal(proof.generation, 1);
    assert.equal(classifyRegistrationReceipt(proof, nonce, "VERA-NODE-1").status,
      "REGISTRY_SESSION_OBSERVED_UNATTESTED");
    assert.equal(JSON.stringify(proof).includes("test-device-only"), false, "no token in proof");

    const unauthHealth = await fetch("http://127.0.0.1:" + port + "/health").then(r => r.json()) as any;
    assert.equal(unauthHealth.devices, undefined, "no unauthenticated registry data");
    const authHealth = await fetch("http://127.0.0.1:" + port + "/health",
      { headers: { authorization: "Bearer test-client-only" } }).then(r => r.json()) as any;
    assert.equal(authHealth.devices.length, 1);
    assert.equal(authHealth.devices[0].generation, proof.generation);
    assert.equal(authHealth.devices[0].connectedAt, proof.connectedAt);

    const replacement = await connect("VERA-NODE-1", "test-device-only");
    const latest = messageWhen(replacement.ws, m => m.type === "registration-receipt");
    replacement.ws.send(JSON.stringify({ type: "registration-probe", nonce }));
    const newProof = await latest;
    assert.equal(newProof.generation, 2, "replaced session increments generation");
    assert.notEqual(newProof.connectedAt, 0);
    const bad = messageWhen(replacement.ws, m => m.type === "registration-receipt", 7000);
    replacement.ws.send(JSON.stringify({ type: "registration-probe", nonce: "1234567890abcdef1234567890abcdef" }));
    const renewed = await bad;
    assert.equal(classifyRegistrationReceipt(renewed, nonce, "VERA-NODE-1").status,"HELD", "old nonce cannot be reused");
  } finally {
    for (const ws of sockets) ws.terminate();
    proc.kill();
  }
});
