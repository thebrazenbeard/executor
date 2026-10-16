import test from "node:test";
import assert from "node:assert/strict";
import { EffectLedger } from "../effect-ledger.js";

test("unknown effect outcome cannot silently become completed or safe-to-replay", () => {
  const ledger = new EffectLedger();
  ledger.create("effect:ambiguous", "VERA-NODE-1", 6);
  ledger.transition("effect:ambiguous", "ADMITTED");
  ledger.transition("effect:ambiguous", "DISPATCHED");
  ledger.transition("effect:ambiguous", "OUTCOME_UNKNOWN");
  assert.throws(() => ledger.transition("effect:ambiguous", "COMPLETED"), /terminal|unknown|transition/i);
  assert.equal(ledger.get("effect:ambiguous")?.disposition, "OUTCOME_UNKNOWN");
  assert.equal(ledger.get("effect:ambiguous")?.replaySafe, false);
});

test("duplicate effect creation cannot erase ambiguous outcome", () => {
  const ledger = new EffectLedger();
  ledger.create("effect:ambiguous", "VERA-NODE-1", 6);
  ledger.transition("effect:ambiguous", "ADMITTED");
  ledger.transition("effect:ambiguous", "DISPATCHED");
  ledger.transition("effect:ambiguous", "OUTCOME_UNKNOWN");
  assert.throws(() => ledger.create("effect:ambiguous", "VERA-NODE-1", 7, true),
    /duplicate|already|exists/i);
  const current = ledger.get("effect:ambiguous");
  assert.equal(current?.generation, 6);
  assert.equal(current?.disposition, "OUTCOME_UNKNOWN");
  assert.equal(current?.replaySafe, false);
});

test("valid success and known failure paths remain supported", () => {
  const ledger = new EffectLedger();
  ledger.create("completed", "VERA-NODE-1", 6);
  ledger.transition("completed", "ADMITTED");
  ledger.transition("completed", "DISPATCHED");
  assert.equal(ledger.transition("completed", "COMPLETED").disposition, "COMPLETED");
  ledger.create("early-failure", "VERA-NODE-1", 6);
  ledger.transition("early-failure", "ADMITTED");
  assert.equal(ledger.transition("early-failure", "FAILED").disposition, "FAILED");
});
