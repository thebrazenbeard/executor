import test from "node:test";
import assert from "node:assert/strict";
import { WorkContextOrchestrator } from "../orchestrator.js";

test("upstream work contexts have independent execution identities", async () => {
  const o = new WorkContextOrchestrator(32);
  const a = o.create();
  const b = o.create();
  assert.notEqual(a.id, b.id);
  await o.run(a.id, async () => 1);
  assert.equal(o.get(a.id)?.state, "completed");
  assert.equal(o.get(b.id)?.state, "queued");
});

test("effect binding is explicit and device-scoped", () => {
  const o = new WorkContextOrchestrator(32);
  const context = o.create();
  o.bindEffect(context.id, "lappy");
  assert.equal(o.get(context.id)?.effectDevice, "lappy");
  assert.equal(o.get(context.id)?.state, "waiting-for-effect");
});

test("completed upstream-context history is bounded", async () => {
  const o = new WorkContextOrchestrator(32);
  for (let i = 0; i < 1030; i++) {
    const context = o.create();
    await o.run(context.id, async () => i);
  }
  assert.ok(o.list().length <= 1024);
});

test("parent execution lineage is preserved on the created event", () => {
  const o = new WorkContextOrchestrator(32);
  const parent = o.create();
  const child = o.create(parent.id);
  assert.equal(child.parentExecutionId, parent.id);
  assert.equal(o.events.since(child.id, 0)[0]?.parentExecutionId, parent.id);
});
