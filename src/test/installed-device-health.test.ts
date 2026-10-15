import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("device transport diagnostic differentiates absent process from authenticated health", { skip: process.platform !== "win32" }, () => {
  const source = readFileSync("scripts/Get-ExecutorInstalledDeviceHealth.ps1", "utf8");
  assert.doesNotMatch(source, /Stop-Process|Terminate\(|Start-Process|device-token\.dpapi/);
  const root = mkdtempSync(path.join(os.tmpdir(), "executor-health-fixture-"));
  try {
    const absentAgent = path.join(root, "no-agent-installed");
    mkdirSync(absentAgent);
    writeFileSync(path.join(root, "device.json"), JSON.stringify({
      schema: "EXECUTOR_INSTALLED_DEVICE_V1",
      device_id: "synthetic-health-fixture",
      agent_root: absentAgent,
      service_url: "https://127.0.0.1:9443"
    }));
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/Get-ExecutorInstalledDeviceHealth.ps1", "-RuntimeRoot", root],
      { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.status, "AGENT_PROCESS_NOT_FOUND");
    assert.equal(report.transport_connected_process_count, 0);
    assert.equal(report.authenticated_server_ready, "NOT_VERIFIED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
