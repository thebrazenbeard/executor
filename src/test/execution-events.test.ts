import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionEventLog } from "../execution-events.js";

test("execution events preserve sequence and lineage", () => {
  const log = new ExecutionEventLog(3);
  assert.equal(log.append("exec-1", "started", { x: 1 }).seq, 1);
  assert.equal(log.append("exec-1", "progress", { x: 2 }).seq, 2);
  assert.deepEqual(log.since("exec-1", 1).map(e => e.seq), [2]);
  assert.equal(log.append("child", "started", {}, "parent").parentExecutionId, "parent");
});
