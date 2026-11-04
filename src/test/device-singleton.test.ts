import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { acquireDeviceSingleton, deviceSingletonIdentifier } from "../device-singleton.js";

// The installed-agent guard is intentionally Windows-only. A Linux socket
// policy has not been qualified; the Linux agent retains its prior behavior.
const unsupported = process.platform === "win32" ? false : "Windows named-pipe lifecycle test";

const fixture = `
  import { acquireDeviceSingleton } from ${JSON.stringify(new URL("../device-singleton.js", import.meta.url).href)};
  try {
    const server = await acquireDeviceSingleton(process.argv[1]);
    process.stdout.write("READY\\n");
    process.stdin.once("end", () => server.close());
    process.stdin.resume();
  } catch (error) {
    process.stdout.write(error?.code === "EADDRINUSE" ? "BUSY\\n" : "ERROR\\n");
    process.exit(error?.code === "EADDRINUSE" ? 2 : 3);
  }
`;

async function startProbe(key: string): Promise<{ child: ChildProcess; line: string }> {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", fixture, key], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  const line = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`singleton probe timed out: ${output}`)), 5000);
    child.stdout!.on("data", chunk => {
      output += String(chunk);
      if (!output.includes("\n")) return;
      clearTimeout(timeout);
      resolve(output.split("\n")[0]!);
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => {
      if (output.includes("\n")) return;
      clearTimeout(timeout);
      reject(new Error(`singleton probe exited ${code} without readiness: ${output}`));
    });
  });
  return { child, line };
}

async function stopProbe(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.on("error", error => {
    if ((error as NodeJS.ErrnoException).code !== "EPIPE") throw error;
  });
  const exited = once(child, "exit");
  let timer: NodeJS.Timeout | undefined;
  try {
    child.stdin?.end();
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          child.kill();
          reject(new Error("singleton probe failed to exit"));
        }, 5000);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("one live process owns a device identity until it exits", { skip: unsupported }, async () => {
  const key = randomBytes(16).toString("hex");
  const first = await startProbe(key);
  assert.equal(first.line, "READY");
  try {
    const second = await startProbe(key);
    assert.equal(second.line, "BUSY");
    await stopProbe(second.child);
  } finally {
    await stopProbe(first.child);
  }
  const third = await startProbe(key);
  assert.equal(third.line, "READY");
  await stopProbe(third.child);
});

test("distinct device identities can run together", { skip: unsupported }, async () => {
  const first = await startProbe(randomBytes(16).toString("hex"));
  const second = await startProbe(randomBytes(16).toString("hex"));
  try {
    assert.equal(first.line, "READY");
    assert.equal(second.line, "READY");
  } finally {
    await stopProbe(first.child);
    await stopProbe(second.child);
  }
});

test("case-distinct device IDs can bind concurrently", { skip: unsupported }, async () => {
  const origin = "https://server.example/device";
  const upper = await startProbe(deviceSingletonIdentifier(origin, "Lappy"));
  let lower: Awaited<ReturnType<typeof startProbe>> | undefined;
  try {
    lower = await startProbe(deviceSingletonIdentifier(origin, "lappy"));
    assert.equal(upper.line, "READY");
    assert.equal(lower.line, "READY");
  } finally {
    await stopProbe(upper.child);
    if (lower) await stopProbe(lower.child);
  }
});

test("singleton identity rejects unbounded or path-like values", async () => {
  await assert.rejects(acquireDeviceSingleton("../not-a-hash"), /invalid Executor device singleton identifier/);
  await assert.rejects(acquireDeviceSingleton("a".repeat(33)), /invalid Executor device singleton identifier/);
});

test("installed and direct device-agent share service-device identity across payload upgrades", () => {
  const a = deviceSingletonIdentifier("https://SERVER.example:443/device?token=not-for-pipe", "Lappy");
  const b = deviceSingletonIdentifier("https://server.example/device", "Lappy");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{32}$/);
  // No payload root enters the key, so a versioned upgrade cannot double-own.
  assert.notEqual(a, deviceSingletonIdentifier("https://other.example/device", "Lappy"));
  // Both input paths are rewritten to /device by device-agent.ts.
  assert.equal(a, deviceSingletonIdentifier("https://server.example/other-device-route", "Lappy"));
  assert.notEqual(a, deviceSingletonIdentifier("https://server.example/device", "VN1"));
  assert.notEqual(a, deviceSingletonIdentifier("https://server.example/device", "lappy"));
});
