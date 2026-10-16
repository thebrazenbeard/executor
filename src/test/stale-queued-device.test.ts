import test from "node:test";
import assert from "node:assert/strict";
import { DeviceConnection, DeviceRegistry } from "../device-registry.js";

class DelayedCloseSocket {
  OPEN = 1;
  readyState = 1;
  sent: Array<{requestId:string}> = [];
  closeCalls = 0;
  send(raw:string, done?: (error?:Error)=>void) {
    this.sent.push(JSON.parse(raw));
    done?.();
  }
  close() { this.closeCalls += 1; /* deliberately remains OPEN before close event */ }
}
const wait = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));

test("queued prior-session work never dispatches after registry replacement during delayed TCP close", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedCloseSocket();
  const old = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(old);
  const first = old.request({jsonrpc:"2.0", id:1, method:"tools/call"},500);
  const second = old.request({jsonrpc:"2.0", id:2, method:"tools/call"},500);
  const handled = Promise.allSettled([first,second]);
  await wait(5);
  assert.equal(socket.sent.length,1,"second request should be queued before replacement");
  const successor = new DeviceConnection("VERA-NODE-1", new DelayedCloseSocket() as any,1);
  registry.attach(successor);
  assert.equal(registry.getIfGeneration("VERA-NODE-1",1),undefined);
  assert.equal(socket.readyState,socket.OPEN,"old socket still appears established");
  assert.equal(socket.closeCalls,1);
  old.accept({type:"response",requestId:socket.sent[0].requestId,
    payload:{jsonrpc:"2.0",id:1,result:{}}});
  await wait(15);
  const leakedWork = socket.sent.length > 1;
  if(leakedWork) old.accept({type:"response",requestId:socket.sent[1].requestId,
    payload:{jsonrpc:"2.0",id:2,result:{}}});
  const settled = await handled;
  assert.equal(leakedWork,false,"stale queued work reached old registered generation");
  assert.equal(settled[1].status,"rejected");
});

test("queued notification is also blocked after replacement even if socket remains OPEN", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedCloseSocket();
  const old = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(old);
  const first = old.request({jsonrpc:"2.0",id:3,method:"tools/call"},500);
  const notification = old.notify({jsonrpc:"2.0",method:"notifications/initialized"});
  const outcomes = Promise.allSettled([first,notification]);
  await wait(5);
  assert.equal(socket.sent.length,1);
  registry.attach(new DeviceConnection("VERA-NODE-1",new DelayedCloseSocket() as any,1));
  const results = await outcomes;
  assert.equal(socket.readyState,socket.OPEN);
  assert.equal(socket.sent.length,1,"queued old-session notification must not leak");
  assert.equal(results[1].status,"rejected");
});
