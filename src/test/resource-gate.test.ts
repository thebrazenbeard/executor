import test from "node:test";
import assert from "node:assert/strict";
import { ResourceKeyGate } from "../resource-gate.js";

test("same resource key serializes effects while distinct keys remain parallel", async () => {
  const gate = new ResourceKeyGate();
  let activeSame = 0;
  let maxSame = 0;
  let activeTotal = 0;
  let maxTotal = 0;
  let releaseA!: () => void;
  let releaseB!: () => void;
  const waitA = new Promise<void>(r => { releaseA = r; });
  const waitB = new Promise<void>(r => { releaseB = r; });

  const a1 = gate.run("shell:alpha", async () => {
    activeSame++; activeTotal++; maxSame = Math.max(maxSame, activeSame); maxTotal = Math.max(maxTotal, activeTotal);
    await waitA; activeSame--; activeTotal--;
  });
  const a2 = gate.run("shell:alpha", async () => {
    activeSame++; activeTotal++; maxSame = Math.max(maxSame, activeSame); maxTotal = Math.max(maxTotal, activeTotal);
    await waitB; activeSame--; activeTotal--;
  });
  const b = gate.run("shell:beta", async () => {
    activeTotal++; maxTotal = Math.max(maxTotal, activeTotal); await waitA; activeTotal--;
  });

  await new Promise(r => setTimeout(r, 20));
  assert.equal(maxSame, 1);
  assert.equal(maxTotal, 2);
  releaseA();
  await new Promise(r => setTimeout(r, 5));
  releaseB();
  await Promise.all([a1, a2, b]);
});

test("timed-out resource waiter never begins a delayed effect", async () => {
  const gate = new ResourceKeyGate();
  let release!: () => void;
  const first = gate.run("shell:alpha", () => new Promise<void>(r => { release = r; }));
  let secondRan = false;
  await assert.rejects(gate.run("shell:alpha", async () => { secondRan = true; }, 20), /resource key admission timed out/);
  assert.equal(secondRan, false);
  release();
  await first;
  assert.equal(secondRan, false);
  // A timed-out waiter must not poison the key for later legitimate work.
  assert.equal(await gate.run("shell:alpha", async () => "fresh", 20), "fresh");
});

test("already expired resource budget cannot admit even an idle key", async () => {
  const gate = new ResourceKeyGate();
  let executed = false;
  await assert.rejects(gate.run("idle-key", async () => { executed = true; }, 0), /admission timed out/);
  assert.equal(executed, false);
});
