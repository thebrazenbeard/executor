import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { classifyDeviceSupervision, probeWindowsDeviceLease } from "../dist/device-supervision.js";

// Source-only diagnostic. Never starts, stops, kills, registers or repairs.
// The output describes observations, not installed process custody.
if (process.platform !== "win32") {
  console.error("Windows device supervision probe is unsupported on this host");
  process.exit(2);
}

const runtimeRoot = process.argv[2] ?? path.join(process.env.LOCALAPPDATA ?? "", "Executor");
const ps = `$ErrorActionPreference='Stop'; try { $t = Get-ScheduledTask -TaskName 'Executor Device' -ErrorAction Stop; if ($t.State -eq 'Running') { 'running' } else { 'not-running' } } catch { 'unknown' }`;
let taskState = "unknown";
const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
  encoding: "utf8", timeout: 8000, windowsHide: true
});
if (!result.error && result.status === 0) {
  const state = result.stdout.trim().toLowerCase();
  if (state === "running" || state === "not-running") taskState = state;
}

let leaseState = "unknown";
let configurationBound = false;
try {
  const config = JSON.parse(readFileSync(path.join(runtimeRoot, "device.json"), "utf8").replace(/^\uFEFF/, ""));
  if (config.schema === "EXECUTOR_INSTALLED_DEVICE_V1" &&
      typeof config.service_url === "string" && typeof config.device_id === "string") {
    configurationBound = true;
    leaseState = await probeWindowsDeviceLease(config.service_url, config.device_id);
  }
} catch {
  // Do not serialize config, credentials, path details or arbitrary errors.
}

const verdict = classifyDeviceSupervision(taskState, leaseState);
console.log(JSON.stringify({
  schema: "EXECUTOR_DEVICE_SUPERVISION_PROBE_V1",
  observedAtUtc: new Date().toISOString(),
  taskState,
  leaseState,
  configurationBound,
  ...verdict,
  qualification: "source-only observer; no process-owner attestation",
  limitations: [
    "Pipe connection does not identify its owning process or attest MCP/tunnel readiness",
    "A missing lease cannot exclude an unguarded legacy device agent",
    "This probe never authorizes automatic restart, termination or scheduled-task changes"
  ]
}));
