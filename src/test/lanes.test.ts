import test from "node:test";
import assert from "node:assert/strict";
import { LanePool } from "../lanes.js";

test("LanePool obeys configured runtime capacity without encoding a product ceiling", async () => {
  const pool = new LanePool(12);
  let active = 0;
  let max = 0;
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const jobs = Array.from({ length: 40 }, () => pool.run(async () => {
    active++;
    max = Math.max(max, active);
    await gate;
    active--;
  }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(max, 12);
  assert.equal(pool.activeCount, 12);
  assert.equal(pool.queuedCount, 28);
  release();
  await Promise.all(jobs);
  assert.equal(pool.activeCount, 0);
});
