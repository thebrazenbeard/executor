import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonlExecutionEventStore } from "../execution-store.js";

test("JSONL execution store survives a new store instance", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "executor-events-"));
  const file = path.join(dir, "events.jsonl");
  try {
    const first = new JsonlExecutionEventStore(file);
    await first.append({ executionId: "x", seq: 1, type: "created", at: 1, data: {} });
    await first.append({ executionId: "y", seq: 1, type: "created", at: 2, data: {} });
    const restarted = new JsonlExecutionEventStore(file);
    assert.deepEqual((await restarted.load("x")).map(e => e.executionId), ["x"]);
    assert.equal((await restarted.load()).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
