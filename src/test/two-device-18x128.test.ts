import test from "node:test";
import assert from "node:assert/strict";
import { capacityConfig } from "../config.js";
import { DeviceConnection, DeviceRegistry } from "../device-registry.js";
import { WorkContextOrchestrator } from "../orchestrator.js";

class FakeSocket {
  OPEN = 1; readyState = 1;
  sent: any[] = [];
  send(wire: string, cb?: (error?: Error) => void) {
    this.sent.push(JSON.parse(wire));
    cb?.();
  }
  close() {}
}
test("user-selected 18 total execution / 128 upstream admits nine per named device", async () => {
  const config = capacityConfig({
    EXECUTOR_EXECUTION_CAPACITY: "9",
    EXECUTOR_UPSTREAM_CONTEXT_CAPACITY: "128"
  });
  assert.deepEqual(config, { executionPerDevice: 9, upstreamContexts: 128 });
  const registry = new DeviceRegistry();
  const sockets = [new FakeSocket(), new FakeSocket()];
  const ids = ["Lappy", "VERA-NODE-1"];
  ids.forEach((id, i) => registry.attach(new DeviceConnection(id, sockets[i] as any, config.executionPerDevice)));
  const logic = new WorkContextOrchestrator(config.upstreamContexts);
  let unblock!: () => void;
  const hold = new Promise<void>(resolve => { unblock = resolve; });
  const jobs = Array.from({length:128}, () => {
    const lane = logic.create();
    return logic.run(lane.id, async () => hold);
  });
  const requests = ids.flatMap((id, i) => Array.from({length:12}, (_, n) => registry.get(id)!.request({
    jsonrpc: "2.0", id: i*100+n, method:"tools/list"
  }, 5000)));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(logic.activeCount, 128);
  assert.equal(logic.queuedCount, 0);
  for (let i=0; i<2; i++) {
    assert.equal(registry.get(ids[i])!.activeCount, 9);
    assert.equal(registry.get(ids[i])!.queuedCount, 3);
    assert.equal(sockets[i].sent.length, 9);
  }
  unblock();
  await Promise.all(jobs);
  for (let i=0; i<2; i++) {
    for(let n=0;n<12;n++){
      for(let spin=0;spin<80 && sockets[i].sent.length<=n;spin++)await new Promise(r=>setTimeout(r,1));
      const wire = sockets[i].sent[n];
      assert.ok(wire);
      registry.get(ids[i])!.accept({type:"response", requestId:wire.requestId,
        payload:{jsonrpc:"2.0",id:wire.payload.id,result:{}}});
      await new Promise(r=>setTimeout(r,1));
    }
  }
  await Promise.all(requests);
  assert.equal(logic.activeCount,0);
  assert.equal(registry.get(ids[0])!.activeCount + registry.get(ids[1])!.activeCount,0);
});
