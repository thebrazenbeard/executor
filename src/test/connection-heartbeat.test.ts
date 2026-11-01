import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";
import { attachConnectionHeartbeat } from "../connection-heartbeat.js";

async function openPeer(autoPong: boolean) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1", autoPong });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new WebSocket("ws://127.0.0.1:" + address.port);
  let timeoutCount = 0;
  const stop = attachConnectionHeartbeat(client, {
    intervalMs: 100,
    onTimeout: () => { timeoutCount++; }
  });
  await once(client, "open");

  async function close() {
    stop();
    client.terminate();
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  return { client, stop, timeoutCount: () => timeoutCount, close };
}

test("heartbeat leaves a responsive real WebSocket open", { timeout: 5_000 }, async () => {
  const peer = await openPeer(true);
  try {
    await delay(550);
    assert.equal(peer.client.readyState, WebSocket.OPEN);
    assert.equal(peer.timeoutCount(), 0);
  } finally {
    await peer.close();
  }
});

test("heartbeat terminates a silent real WebSocket and signals timeout once", { timeout: 5_000 }, async () => {
  const peer = await openPeer(false);
  try {
    await once(peer.client, "close");
    assert.equal(peer.client.readyState, WebSocket.CLOSED);
    assert.equal(peer.timeoutCount(), 1);
  } finally {
    await peer.close();
  }
});

test("heartbeat stop removes liveness timers before further pings", { timeout: 5_000 }, async () => {
  const peer = await openPeer(false);
  try {
    peer.stop();
    await delay(350);
    assert.equal(peer.client.readyState, WebSocket.OPEN);
    assert.equal(peer.timeoutCount(), 0);
  } finally {
    await peer.close();
  }
});
