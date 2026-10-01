import test from "node:test";
import assert from "node:assert/strict";
import { EffectLedger } from "../effect-ledger.js";

test("effect lifecycle preserves ambiguous post-dispatch outcome", () => {
  const ledger = new EffectLedger();
  ledger.create("r1", "dev", 7, false);
  ledger.transition("r1", "ADMITTED");
  ledger.transition("r1", "DISPATCHED");
  const final = ledger.transition("r1", "OUTCOME_UNKNOWN");
  assert.equal(final.generation, 7);
  assert.equal(final.replaySafe, false);
  assert.equal(final.disposition, "OUTCOME_UNKNOWN");
});

test("replay safety is explicit rather than inferred from failure", () => {
  const ledger = new EffectLedger();
  assert.equal(ledger.create("unsafe", "dev", 1).replaySafe, false);
  assert.equal(ledger.create("safe", "dev", 1, true).replaySafe, true);
});

test("recent effect evidence is bounded and newest first", () => {
  const ledger = new EffectLedger();
  ledger.create("a", "dev", 1);
  ledger.create("b", "dev", 1);
  ledger.transition("a", "FAILED");
  assert.equal(ledger.recent(1).length, 1);
  assert.throws(() => ledger.recent(0), /1\.\.1000/);
});

test("effect ledger evicts oldest records at its retention bound", () => {
  const ledger = new EffectLedger(2);
  ledger.create("a", "dev", 1);
  ledger.create("b", "dev", 1);
  ledger.create("c", "dev", 1);
  assert.equal(ledger.get("a"), undefined);
  assert.equal(ledger.get("b")?.requestId, "b");
  assert.equal(ledger.get("c")?.requestId, "c");
});
