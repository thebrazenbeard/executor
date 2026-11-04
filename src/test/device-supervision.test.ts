import assert from "node:assert/strict";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deviceSingletonIdentifier } from "../device-singleton.js";
import {
  classifyDeviceSupervision,
  parseScheduledTaskObservation,
  probeWindowsDeviceLease,
  type LeaseObservation,
  type TaskObservation
} from "../device-supervision.js";

test("only a single exact root scheduled task can yield a running verdict", () => {
  const root = { TaskName: "Executor Device", TaskPath: "\\", State: "Running" };
  const other = { TaskName: "Executor Device", TaskPath: "\\Injected\\", State: "Ready" };
  assert.equal(parseScheduledTaskObservation([root]), "running");
  assert.equal(parseScheduledTaskObservation([{ ...root, State: "Ready" }]), "not-running");
  assert.equal(parseScheduledTaskObservation([root, other]), "unknown");
  assert.equal(parseScheduledTaskObservation([other, root]), "unknown");
  assert.equal(parseScheduledTaskObservation([other]), "unknown");
  assert.equal(parseScheduledTaskObservation([root, root]), "unknown");
  assert.equal(parseScheduledTaskObservation([{ ...root, State: "Queued" }]), "unknown");
  assert.equal(parseScheduledTaskObservation([{ ...root, State: 4 }]), "unknown");
  assert.equal(parseScheduledTaskObservation(null), "unknown");
});

test("observer script has an absolute Windows PowerShell pin, never PATH resolution", () => {
  const source = readFileSync(path.resolve("scripts", "probe-device-supervision.mjs"), "utf8");
  assert.match(source, /const powerShell = "C:\\\\Windows\\\\System32/);
  assert.doesNotMatch(source, /spawnSync\(\s*["']powershell\.exe["']/);
});

test("running task and reachable pipe is only provisional supervision evidence", () => {
  assert.deepEqual(classifyDeviceSupervision("running", "connected"), {
    state: "TASK_AND_LEASE_PRESENT", safeToStart: false
  });
});

test("stopped task with live pipe is held as a possible orphan", () => {
  assert.deepEqual(classifyDeviceSupervision("not-running", "connected"), {
    state: "POSSIBLE_ORPHAN", safeToStart: false
  });
});

test("missing pipe cannot attest absence of a legacy unguarded agent", () => {
  assert.deepEqual(classifyDeviceSupervision("not-running", "not-observed"), {
    state: "LEASE_NOT_OBSERVED", safeToStart: false
  });
  assert.deepEqual(classifyDeviceSupervision("running", "not-observed"), {
    state: "TASK_WITHOUT_LEASE", safeToStart: false
  });
});

test("uncertain observations fail closed and no combination permits a start", () => {
  const tasks: TaskObservation[] = ["running", "not-running", "unknown"];
  const leases: LeaseObservation[] = ["connected", "not-observed", "unknown"];
  for (const task of tasks) for (const lease of leases) {
    const verdict = classifyDeviceSupervision(task, lease);
    assert.equal(verdict.safeToStart, false);
    if (task === "unknown" || lease === "unknown") {
      assert.equal(verdict.state, "INDETERMINATE");
    }
  }
});

test("Windows named-pipe probe distinguishes listener and no listener", {
  skip: process.platform !== "win32" ? "Windows named-pipe lifecycle" : false
}, async () => {
  const serviceUrl = `https://${randomBytes(12).toString("hex")}.invalid/device`;
  const deviceId = `fixture-${randomBytes(8).toString("hex")}`;
  const identifier = deviceSingletonIdentifier(serviceUrl, deviceId);
  const pipe = `\\\\.\\pipe\\ExecutorDevice-${identifier}`;
  assert.equal(await probeWindowsDeviceLease(serviceUrl, deviceId), "not-observed");
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipe, () => resolve());
  });
  try {
    assert.equal(await probeWindowsDeviceLease(serviceUrl, deviceId), "connected");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(await probeWindowsDeviceLease(serviceUrl, deviceId), "not-observed");
});

test("Windows CLI emits a conservative receipt without modifying fixture runtime root", {
  skip: process.platform !== "win32" ? "Windows scheduled-task read-only integration" : false
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "executor-supervisor-readonly-"));
  const sentinel = "DO_NOT_ECHO_SYNTHETIC_FIXTURE_SECRET";
  try {
    writeFileSync(path.join(root, "device.json"), "\uFEFF" + JSON.stringify({
      schema: "EXECUTOR_INSTALLED_DEVICE_V1",
      service_url: `https://${randomBytes(12).toString("hex")}.invalid/device`,
      device_id: `fixture-${randomBytes(8).toString("hex")}`,
      synthetic_secret: sentinel
    }), "utf8");
    const runner = path.resolve("scripts", "probe-device-supervision.mjs");
    const result = spawnSync(process.execPath, [runner, root], {
      encoding: "utf8", timeout: 15000, windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(sentinel));
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.schema, "EXECUTOR_DEVICE_SUPERVISION_PROBE_V1");
    assert.equal(receipt.configurationBound, true);
    assert.equal(receipt.leaseState, "not-observed");
    assert.equal(receipt.safeToStart, false);
    assert.deepEqual(readdirSync(root), ["device.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows CLI fails closed on malformed config and absent LOCALAPPDATA", {
  skip: process.platform !== "win32" ? "Windows runtime-root resolution" : false
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "executor-supervisor-boundary-"));
  const runner = path.resolve("scripts", "probe-device-supervision.mjs");
  try {
    writeFileSync(path.join(root, "device.json"), JSON.stringify({
      schema: "EXECUTOR_INSTALLED_DEVICE_V1",
      service_url: "not a url",
      device_id: "fixture"
    }));
    const malformed = spawnSync(process.execPath, [runner, root], {
      encoding: "utf8", timeout: 15000, windowsHide: true
    });
    assert.equal(malformed.status, 0, malformed.stderr);
    assert.equal(JSON.parse(malformed.stdout).configurationBound, false);

    const cwdTrap = path.join(root, "Executor");
    mkdirSync(cwdTrap);
    copyFileSync(path.join(root, "device.json"), path.join(cwdTrap, "device.json"));
    const env = { ...process.env, LOCALAPPDATA: "" };
    const missingRoot = spawnSync(process.execPath, [runner], {
      encoding: "utf8", timeout: 15000, windowsHide: true, cwd: root, env
    });
    assert.equal(missingRoot.status, 0, missingRoot.stderr);
    const receipt = JSON.parse(missingRoot.stdout);
    assert.equal(receipt.configurationBound, false);
    assert.equal(receipt.leaseState, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
