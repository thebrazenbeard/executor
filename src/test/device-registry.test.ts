import test from "node:test";
import assert from "node:assert/strict";
import { DeviceConnection, DeviceEffectError, DeviceRegistry } from "../device-registry.js";

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

test("separate device IDs retain independent execution queues and do not steal each other's lanes", async () => {
  const registry = new DeviceRegistry();
  const socketA = new FakeSocket();
  const socketB = new FakeSocket();
  const a = new DeviceConnection("Lappy", socketA as any, 2);
  const b = new DeviceConnection("VERA-NODE-1", socketB as any, 2);
  registry.attach(a);
  registry.attach(b);
  const jobsA = [1, 2, 3].map(id => a.request({ jsonrpc: "2.0", id, method: "tools/list" }, 5000));
  const jobsB = [4, 5, 6].map(id => b.request({ jsonrpc: "2.0", id, method: "tools/list" }, 5000));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(socketA.sent.length, 2);
  assert.equal(socketB.sent.length, 2);
  assert.equal(a.activeCount, 2);
  assert.equal(b.activeCount, 2);
  assert.equal(a.queuedCount, 1);
  assert.equal(b.queuedCount, 1);

  a.accept({ type: "response", requestId: socketA.sent[0].requestId, payload: { jsonrpc: "2.0", id: 1, result: {} } });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(socketA.sent.length, 3, "Lappy should dispatch independently");
  assert.equal(socketB.sent.length, 2, "VERA-NODE-1 queue should remain independent");
  b.accept({ type: "response", requestId: socketB.sent[0].requestId, payload: { jsonrpc: "2.0", id: 4, result: {} } });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(socketB.sent.length, 3);
  for (const wire of socketA.sent.slice(1)) {
    a.accept({ type: "response", requestId: wire.requestId, payload: { jsonrpc: "2.0", id: wire.payload.id, result: {} } });
  }
  for (const wire of socketB.sent.slice(1)) {
    b.accept({ type: "response", requestId: wire.requestId, payload: { jsonrpc: "2.0", id: wire.payload.id, result: {} } });
  }
  await Promise.all([...jobsA, ...jobsB]);
  assert.equal(a.activeCount, 0);
  assert.equal(b.activeCount, 0);
  assert.equal(a.queuedCount, 0);
  assert.equal(b.queuedCount, 0);
});
