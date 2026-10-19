import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { watchLauncher } from "../launcher-liveness.js";

test("launcher disappearance is detected once without killing unrelated processes", { timeout: 10000 }, async () => {
  const parent = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  await once(parent, "spawn");
  let gone = 0;
  const observed = new Promise<void>(resolve => {
    const stop = watchLauncher(parent.pid!, () => { gone++; stop(); resolve(); }, 25);
  });
  try {
    await delay(100);
    assert.equal(gone, 0);
    const exited = once(parent, "exit");
    parent.kill();
    await exited;
    await Promise.race([observed, delay(5000).then(() => { throw new Error("launcher exit was not observed"); })]);
    await delay(100);
    assert.equal(gone, 1);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally { parent.kill(); }
});
test("launcher watcher cleanup prevents callbacks", async () => {
  const stop = watchLauncher(process.ppid, () => { throw new Error("unexpected callback"); });
  stop();
});
