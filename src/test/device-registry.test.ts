import test from "node:test";
import assert from "node:assert/strict";
import { DeviceConnection, DeviceEffectError } from "../device-registry.js";

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  sent: any[] = [];
  send(data: string, cb?: (error?: Error) => void) {
    this.sent.push(JSON.parse(data));
    cb?.();
  }
  close() {}
}

test("execution capacity is enforced for one device", async () => {
  const socket = new FakeSocket();
  const device = new DeviceConnection("fake", socket as any, 8);
  const requests = Array.from({ length: 16 }, (_, i) => device.request({ jsonrpc: "2.0", id: i + 1, method: "tools/list" }, 5000));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(socket.sent.length, 8);
  assert.equal(device.activeCount, 8);
  assert.equal(device.queuedCount, 8);

  for (let i = 0; i < 16; i++) {
    let wire = socket.sent[i];
    for (let spin = 0; !wire && spin < 100; spin++) { await new Promise(resolve => setTimeout(resolve, 1)); wire = socket.sent[i]; }
    assert.ok(wire, `request ${i + 1} was not dispatched after a lane released`);
    device.accept({ type: "response", requestId: wire.requestId, payload: { jsonrpc: "2.0", id: i + 1, result: {} } });
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  await Promise.all(requests);
  assert.equal(device.activeCount, 0);
  assert.equal(device.queuedCount, 0);
});

test("disconnect rejects in-flight requests and a replacement does not replay them", async () => {
  const firstSocket = new FakeSocket();
  const first = new DeviceConnection("fake", firstSocket as any, 8);
  const pending = first.request({ jsonrpc: "2.0", id: 99, method: "tools/list" }, 5000);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(firstSocket.sent.length, 1);
  first.close("lost");
  await assert.rejects(pending, /lost/);

  const replacementSocket = new FakeSocket();
  new DeviceConnection("fake", replacementSocket as any, 8);
  assert.equal(replacementSocket.sent.length, 0);
});

test("disconnect classifies an already-dispatched request as outcome unknown", async () => {
  const socket = new FakeSocket();
  const device = new DeviceConnection("fake", socket as any, 1);
  const pending = device.request({ jsonrpc: "2.0", id: 1, method: "tools/call" }, 5000);
  await new Promise(resolve => setTimeout(resolve, 5));
  device.close("link lost");
  await assert.rejects(pending, (error: unknown) =>
    error instanceof DeviceEffectError && error.disposition === "OUTCOME_UNKNOWN"
  );
});

test("closed socket before send is a known failed disposition", async () => {
  const socket = new FakeSocket();
  (socket as any).readyState = 3;
  (socket as any).OPEN = 1;
  const device = new DeviceConnection("fake", socket as any, 1);
  await assert.rejects(device.request({ jsonrpc: "2.0", id: 7, method: "tools/list" }), (error: unknown) =>
    error instanceof DeviceEffectError && error.disposition === "FAILED"
  );
});

test("device request queued beyond deadline fails before socket dispatch", async () => {
  const socket = new FakeSocket();
  const device = new DeviceConnection("fake", socket as any, 1);
  const inFlight = device.request({ jsonrpc: "2.0", id: 1, method: "tools/call" }, 500);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(socket.sent.length, 1);

  await assert.rejects(
    device.request({ jsonrpc: "2.0", id: 2, method: "tools/call" }, 20),
    (error: unknown) => error instanceof DeviceEffectError && error.disposition === "FAILED"
  );
  assert.equal(socket.sent.length, 1);
  assert.equal(device.queuedCount, 0);

  device.accept({ type: "response", requestId: socket.sent[0].requestId, payload: { jsonrpc: "2.0", id: 1, result: {} } });
  await inFlight;
  assert.equal(device.activeCount, 0);
  assert.equal(socket.sent.length, 1);
});

test("notification send callback cannot hold a device lane indefinitely", async () => {
  const socket = new FakeSocket();
  socket.send = (data: string) => { socket.sent.push(JSON.parse(data)); }; // no callback
  const device = new DeviceConnection("fake", socket as any, 1);
  let attempted = 0;
  await assert.rejects(
    device.notify({ jsonrpc: "2.0", method: "notifications/initialized" }, 20, () => { attempted++; }),
    (error: unknown) => error instanceof DeviceEffectError && error.disposition === "OUTCOME_UNKNOWN"
  );
  assert.equal(attempted, 1);
  assert.equal(device.activeCount, 0);
});

test("timed-out queued request never marks wire dispatch attempt", async () => {
  const socket = new FakeSocket();
  const device = new DeviceConnection("fake", socket as any, 1);
  const first = device.request({ jsonrpc: "2.0", id: 1, method: "tools/call" }, 500);
  let attempted = 0;
  await assert.rejects(device.request({ jsonrpc: "2.0", id: 2, method: "tools/call" }, 20, () => { attempted++; }),
    (error: unknown) => error instanceof DeviceEffectError && error.disposition === "FAILED");
  assert.equal(attempted, 0);
  assert.equal(socket.sent.length, 1);
  device.accept({ type: "response", requestId: socket.sent[0].requestId, payload: { jsonrpc: "2.0", id: 1, result: {} } });
  await first;
});

test("dispatch-marker exception is known prewire failure with no socket send", async () => {
  const socket = new FakeSocket();
  const device = new DeviceConnection("fake", socket as any, 1);
  const marker = () => { throw new Error("ledger unavailable"); };
  await assert.rejects(device.request({ jsonrpc: "2.0", id: 1, method: "tools/call" }, 100, marker),
    (error: unknown) => error instanceof DeviceEffectError && error.disposition === "FAILED");
  await assert.rejects(device.notify({ jsonrpc: "2.0", method: "notifications/initialized" }, 100, marker),
    (error: unknown) => error instanceof DeviceEffectError && error.disposition === "FAILED");
  assert.equal(socket.sent.length, 0);
  assert.equal(device.activeCount, 0);
});

test("serialization failure never marks dispatch or calls socket.send", async () => {
  const socket = new FakeSocket();
  const device = new DeviceConnection("fake", socket as any, 1);
  const invalidPayload = { jsonrpc: "2.0", method: "tools/call", params: { cyclic: 1n } } as any;
  let marked = 0;
  await assert.rejects(device.request(invalidPayload, 100, () => { marked++; }),
    (error: unknown) => error instanceof DeviceEffectError && error.disposition === "FAILED");
  await assert.rejects(device.notify(invalidPayload, 100, () => { marked++; }),
    (error: unknown) => error instanceof DeviceEffectError && error.disposition === "FAILED");
  assert.equal(marked, 0);
  assert.equal(socket.sent.length, 0);
  assert.equal(device.activeCount, 0);
});
