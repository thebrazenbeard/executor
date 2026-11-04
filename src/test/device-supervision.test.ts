import assert from "node:assert/strict";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { deviceSingletonIdentifier } from "../device-singleton.js";
import {
  classifyDeviceSupervision,
  probeWindowsDeviceLease,
  type LeaseObservation,
  type TaskObservation
} from "../device-supervision.js";

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
