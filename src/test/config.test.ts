import test from "node:test";
import assert from "node:assert/strict";
import { capacityConfig, qualificationStatus } from "../config.js";

test("8 parallel execution lanes and 64 parallel logic lanes are the Executor defaults", () => {
  const defaults = capacityConfig({});
  assert.deepEqual(defaults, { executionPerDevice: 8, upstreamContexts: 64 });
  assert.deepEqual(qualificationStatus(defaults), {
    executionFloor: 8,
    upstreamContextFloor: 64,
    executionMeetsFloor: true,
    upstreamContextMeetsFloor: true
  });
});

test("Executor can be scaled above its 8/64 baseline", () => {
  const scaled = capacityConfig({
    EXECUTOR_EXECUTION_CAPACITY: "16",
    EXECUTOR_UPSTREAM_CONTEXT_CAPACITY: "128"
  });
  assert.deepEqual(scaled, { executionPerDevice: 16, upstreamContexts: 128 });
  assert.equal(qualificationStatus(scaled).executionMeetsFloor, true);
  assert.equal(qualificationStatus(scaled).upstreamContextMeetsFloor, true);
});
