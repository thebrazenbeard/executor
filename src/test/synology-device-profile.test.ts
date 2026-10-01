import test from "node:test";
import assert from "node:assert/strict";
import { effectiveDeviceCapacity, parseDeviceProfile } from "../device-profile.js";

test("legacy devices retain the workstation execution ceiling", () => {
  assert.equal(effectiveDeviceCapacity(8, undefined), 8);
});

test("Synology profile advertises two execution lanes and is clamped by the control plane", () => {
  const profile = parseDeviceProfile({
    kind: "synology-storage",
    platform: "linux",
    arch: "armv7",
    packageArch: "armada38x",
    nodeVersion: "0.1.0",
    executionCapacity: 2
  });
  assert.deepEqual(profile, {
    kind: "synology-storage",
    platform: "linux",
    arch: "armv7",
    packageArch: "armada38x",
    nodeVersion: "0.1.0",
    executionCapacity: 2
  });
  assert.equal(effectiveDeviceCapacity(8, profile), 2);
  assert.equal(effectiveDeviceCapacity(1, profile), 1);
});

test("advertised capacity cannot raise the control-plane ceiling", () => {
  const profile = parseDeviceProfile({ kind: "synology-storage", executionCapacity: 64 });
  assert.equal(effectiveDeviceCapacity(8, profile), 8);
});

test("invalid device capacities are rejected", () => {
  for (const executionCapacity of [0, -1, 1.5, "2", Number.NaN]) {
    assert.throws(() => parseDeviceProfile({ kind: "synology-storage", executionCapacity }), /executionCapacity/);
  }
});

test("profile strings are bounded", () => {
  assert.throws(() => parseDeviceProfile({ kind: "x".repeat(129) }), /kind/);
});
