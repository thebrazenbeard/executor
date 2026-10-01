import test from "node:test";
import assert from "node:assert/strict";
import { DeviceConnection, DeviceRegistry } from "../device-registry.js";

class FakeSocket { closeCalls: unknown[][]=[]; send(_d:string, cb?: (e?:Error)=>void){cb?.();} close(...a:unknown[]){this.closeCalls.push(a);} }

test("replacement increments device generation and stale generation cannot be resolved", () => {
  const registry = new DeviceRegistry();
  const a = new DeviceConnection("dev", new FakeSocket() as any, 8);
  registry.attach(a);
  const first = registry.resolve("dev");
  assert.ok(first);
  assert.equal(first.generation, 1);

  const b = new DeviceConnection("dev", new FakeSocket() as any, 8);
  registry.attach(b);
  const second = registry.resolve("dev");
  assert.ok(second);
  assert.equal(second.generation, 2);
  assert.notEqual(first.generation, second.generation);
  assert.equal(registry.getIfGeneration("dev", first.generation), undefined);
  assert.equal(registry.getIfGeneration("dev", second.generation), b);
});
