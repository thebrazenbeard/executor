import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("occupied device launcher mutex fails closed, not as healthy agent", { skip: process.platform !== "win32" }, () => {
  const source = readFileSync("scripts/Start-ExecutorInstalledDevice.ps1", "utf8");
  assert.match(source, /device health and connectivity NOT verified/);
  assert.match(source, /exit 20/);
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "scripts/Test-ExecutorInstalledDeviceMutex.ps1"
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /PASS launcher lock held/);
});
