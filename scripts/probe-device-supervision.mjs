import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  classifyDeviceSupervision,
  parseScheduledTaskObservation,
  probeWindowsDeviceLease
} from "../dist/device-supervision.js";

// Source-only diagnostic. Never starts, stops, kills, registers or repairs.
// The output describes observations, not installed process custody.
if (process.platform !== "win32") {
  console.error("Windows device supervision probe is unsupported on this host");
  process.exit(2);
}

// Fail closed on nonstandard Windows install roots. Do not invoke a mutable
// PATH-resolved powershell.exe or trust environment variables as a binary path.
const powerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const runtimeRoot = process.argv[2] ??
  (process.env.LOCALAPPDATA ? path.win32.join(process.env.LOCALAPPDATA, "Executor") : null);
const ps = `$ErrorActionPreference='Stop'; try { $rows = @(Get-ScheduledTask -TaskName 'Executor Device' -ErrorAction Stop | ForEach-Object { [pscustomobject]@{TaskName=[string]$_.TaskName;TaskPath=[string]$_.TaskPath;State=[string]$_.State} }); ConvertTo-Json -InputObject $rows -Compress -Depth 3 } catch { 'null' }`;
let taskState = "unknown";
const result = spawnSync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", ps], {
  encoding: "utf8", timeout: 8000, windowsHide: true
});
if (!result.error && result.status === 0) {
  try { taskState = parseScheduledTaskObservation(JSON.parse(result.stdout.trim())); } catch { /* unknown */ }
}

let leaseState = "unknown";
let configurationBound = false;
try {
  if (runtimeRoot && path.win32.isAbsolute(runtimeRoot)) {
    const config = JSON.parse(readFileSync(path.join(runtimeRoot, "device.json"), "utf8").replace(/^\uFEFF/, ""));
    if (config.schema === "EXECUTOR_INSTALLED_DEVICE_V1" &&
        typeof config.service_url === "string" && typeof config.device_id === "string" &&
        config.device_id.length > 0) {
      const route = new URL(config.service_url);
      if (!route.hostname || !["https:", "http:", "wss:", "ws:"].includes(route.protocol)) {
        throw new Error("invalid service URL");
      }
      leaseState = await probeWindowsDeviceLease(config.service_url, config.device_id);
      configurationBound = true;
    }
  }
} catch {
  // Do not serialize config, credentials, path details or arbitrary errors.
  configurationBound = false;
  leaseState = "unknown";
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
