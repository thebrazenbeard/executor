import test from "node:test";
import assert from "node:assert/strict";
import { DeviceConnection, DeviceEffectError, DeviceRegistry } from "../device-registry.js";

class ThrowingSocket {
  OPEN = 1;
  readyState = 1;
  sends = 0;
  close() {}
  send(_raw: string, _done?: (error?: Error) => void) {
    this.sends++;
    throw new Error("synthetic ambiguous socket send throw");
  }
}

test("synchronous request socket.send throw must not leak pending state or become known FAILED", async () => {
  const socket = new ThrowingSocket();
  const device = new DeviceConnection("VERA-NODE-1", socket as any, 1);
  const registry = new DeviceRegistry();
  registry.attach(device);
  const result = await Promise.allSettled([device.request({
    jsonrpc: "2.0", id: 7, method:"tools/call"
  },300)]);
  assert.equal(socket.sends,1);
  assert.equal(result[0].status,"rejected");
  if (result[0].status === "rejected") {
    assert.ok(result[0].reason instanceof DeviceEffectError,
      "ambiguous on-wire attempt must be DeviceEffectError");
    assert.equal(result[0].reason.disposition,"OUTCOME_UNKNOWN");
  }
  assert.equal((device as any).pending.size,0,"pending request leaked after send throw");
  assert.equal(device.activeCount,0);
});

test("asynchronous request send error is classified unknown and clears pending", async () => {
  class CallbackErrorSocket extends ThrowingSocket {
    override send(_raw: string, done?: (error?: Error) => void) {
      this.sends++;
      done?.(new Error("synthetic async socket failure"));
    }
  }
  const socket = new CallbackErrorSocket();
  const device = new DeviceConnection("VERA-NODE-1",socket as any,1);
  const result = await Promise.allSettled([device.request({
    jsonrpc:"2.0",id:8,method:"tools/call"
  },300)]);
  assert.equal(socket.sends,1);
  assert.equal(result[0].status,"rejected");
  if(result[0].status==="rejected") {
    assert.ok(result[0].reason instanceof DeviceEffectError);
    assert.equal(result[0].reason.disposition,"OUTCOME_UNKNOWN");
  }
  assert.equal((device as any).pending.size,0);
  assert.equal(device.activeCount,0);
});
