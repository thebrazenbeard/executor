import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";
import { attachHeartbeat } from "../connection-heartbeat.js";

async function fixture(autoPong: boolean) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1", autoPong });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new WebSocket("ws://127.0.0.1:" + address.port);
  let timeouts = 0;
  const stop = attachHeartbeat(client, { intervalMs: 100, onTimeout: () => { timeouts++; } });
  await once(client, "open");
  return { client, stop, timeouts: () => timeouts, close: async () => {
    stop(); client.terminate();
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }};
}

test("heartbeat preserves a responsive real WebSocket peer", { timeout: 5000 }, async () => {
  const f = await fixture(true);
  try { await delay(550); assert.equal(f.client.readyState, WebSocket.OPEN); assert.equal(f.timeouts(), 0); }
  finally { await f.close(); }
});
test("heartbeat terminates a silent peer so the agent can reconnect", { timeout: 5000 }, async () => {
  const f = await fixture(false);
  try { await once(f.client, "close"); assert.equal(f.timeouts(), 1); }
  finally { await f.close(); }
});
test("heartbeat cleanup cancels detection for an otherwise silent peer", { timeout: 5000 }, async () => {
  const f = await fixture(false);
  try { f.stop(); await delay(350); assert.equal(f.client.readyState, WebSocket.OPEN); assert.equal(f.timeouts(), 0); }
  finally { await f.close(); }
});
