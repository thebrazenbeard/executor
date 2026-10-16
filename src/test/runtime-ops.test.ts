import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Executor ships explicit start stop restart and status operations", async () => {
  const start = await readFile("scripts/Start-ExecutorRuntime.ps1", "utf8");
  const stop = await readFile("scripts/Stop-ExecutorRuntime.ps1", "utf8");
  const restart = await readFile("scripts/Restart-ExecutorRuntime.ps1", "utf8");
  const status = await readFile("scripts/Get-ExecutorStatus.ps1", "utf8");

  assert.match(start, /runtime-state\.json/);
  assert.match(start, /server_pid/);
  assert.match(start, /device_pid/);
  assert.match(start, /tunnel_pid/);
  assert.match(start, /EXECUTOR_EXECUTION_CAPACITY.*8/);
  assert.match(start, /EXECUTOR_LOGIC_CAPACITY.*64/);
  assert.match(start, /connectedDeviceCount/);
  assert.match(start, /mcp_session_verified/);
  assert.match(start, /HEALTH_URL_FILE/);
  assert.match(start, /tunnel_health_url/);

  assert.match(stop, /runtime-state\.json/);
  assert.match(stop, /Win32_Process/);
  assert.match(stop, /CommandLine/);

  assert.match(restart, /Stop-ExecutorRuntime/);
  assert.match(restart, /Start-ExecutorRuntime/);

  assert.match(status, /runtime-state\.json/);
  assert.match(status, /\/health/);
  assert.match(status, /state\.local_mcp/);
  assert.match(status, /\/readyz/);
  assert.match(status, /tunnel_ready/);
  assert.equal(status.includes("http://127.0.0.1:8787/health"), false);
  assert.match(stop, /allSafe/);
  assert.match(stop, /Runtime state retained/);
});

test("runtime state must not persist tunnel API secret or bearer credentials", async () => {
  const start = await readFile("scripts/Start-ExecutorRuntime.ps1", "utf8");
  const stateBlock = start.match(/\[pscustomobject\]@\{([\s\S]*?)\}\s*\|\s*ConvertTo-Json/i)?.[1] ?? "";
  assert.ok(stateBlock.length > 0, "runtime state object not found");
  assert.equal(/API_SECRET|API_KEY|CLIENT_TOKEN|DEVICE_TOKEN/i.test(stateBlock), false);
});
