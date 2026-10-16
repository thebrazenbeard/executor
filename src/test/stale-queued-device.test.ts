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

class DelayedSendSocket extends DelayedCloseSocket {
  callbacks: Array<(error?: Error)=>void> = [];
  override send(raw:string, done?: (error?:Error)=>void) {
    this.sent.push(JSON.parse(raw));
    if (done) this.callbacks.push(done);
  }
}
test("notification send callback after session retirement must not report success", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedSendSocket();
  const old = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(old);
  const outcome = old.notify({jsonrpc:"2.0",method:"notifications/initialized"});
  const observed = Promise.allSettled([outcome]);
  await wait(5);
  assert.equal(socket.sent.length,1);
  assert.equal(socket.callbacks.length,1);
  registry.attach(new DeviceConnection("VERA-NODE-1",new DelayedCloseSocket() as any,1));
  assert.equal(socket.readyState,socket.OPEN);
  socket.callbacks[0]();
  const settled = await observed;
  assert.equal(settled[0].status,"rejected","late completion must not report delivered");
  if (settled[0].status === "rejected") {
    assert.equal((settled[0].reason as any).disposition,"OUTCOME_UNKNOWN");
  }
});

test("retirement settles an in-flight notification without waiting for socket callback", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedSendSocket();
  const old = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(old);
  const result = old.notify({jsonrpc:"2.0",method:"notifications/initialized"});
  const handled = Promise.allSettled([result]);
  await wait(5);
  assert.equal(socket.callbacks.length,1);
  registry.attach(new DeviceConnection("VERA-NODE-1",new DelayedCloseSocket() as any,1));
  const settled = await Promise.race([handled,wait(90).then(()=>null)]);
  assert.ok(settled,"retirement must settle the send even if its callback never arrives");
  assert.equal(settled[0].status,"rejected");
  if (settled[0].status === "rejected") assert.equal((settled[0].reason as any).disposition,"OUTCOME_UNKNOWN");
});

test("notification successful send callback before retirement remains completed", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedSendSocket();
  const old = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(old);
  const result = old.notify({jsonrpc:"2.0",method:"notifications/initialized"});
  await wait(5);
  socket.callbacks[0]();
  await assert.doesNotReject(result);
  registry.attach(new DeviceConnection("VERA-NODE-1",new DelayedCloseSocket() as any,1));
});

test("unresponsive notification send callback cannot occupy execution lane indefinitely", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedSendSocket();
  const current = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(current);
  // 30ms synthetic deadline; no socket callback and no retirement event.
  const outcome = (current.notify as any)({jsonrpc:"2.0",method:"notifications/initialized"},30);
  const observed = Promise.allSettled([outcome]);
  const result = await Promise.race([observed,wait(140).then(()=>null)]);
  assert.ok(result,"send callback did not return and execution lane was never freed");
  assert.equal(result[0].status,"rejected");
  if(result[0].status==="rejected") assert.equal((result[0].reason as any).disposition,"OUTCOME_UNKNOWN");
  assert.equal(current.activeCount,0);
});

test("late callback after notification timeout cannot rewrite unknown outcome", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedSendSocket();
  const current = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(current);
  const outcome = current.notify({jsonrpc:"2.0",method:"notifications/initialized"},30);
  const settled = await Promise.allSettled([outcome]);
  assert.equal(settled[0].status,"rejected");
  if (settled[0].status === "rejected")
    assert.equal((settled[0].reason as any).disposition,"OUTCOME_UNKNOWN");
  socket.callbacks[0]();
  await wait(5);
  assert.equal(current.activeCount,0);
});
test("invalid notification deadlines fail without sending", async () => {
  const registry = new DeviceRegistry();
  const socket = new DelayedSendSocket();
  const current = new DeviceConnection("VERA-NODE-1",socket as any,1);
  registry.attach(current);
  for (const deadline of [0,-1,NaN,Infinity,true,1.5,600001]) {
    const settled = await Promise.allSettled([
      (current.notify as any)({jsonrpc:"2.0",method:"notifications/initialized"},deadline)
    ]);
    assert.equal(settled[0].status,"rejected",String(deadline));
    if (settled[0].status==="rejected")
      assert.equal((settled[0].reason as any).disposition,"FAILED");
  }
  assert.equal(socket.sent.length,0);
});
