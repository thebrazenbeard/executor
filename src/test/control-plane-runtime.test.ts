import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("headless control plane starts server plus tunnel without requiring a local workstation", async () => {
  const start = await readFile("scripts/Start-ExecutorControlPlane.ps1", "utf8");
  const stop = await readFile("scripts/Stop-ExecutorControlPlane.ps1", "utf8");
  const restart = await readFile("scripts/Restart-ExecutorControlPlane.ps1", "utf8");
  const status = await readFile("scripts/Get-ExecutorControlPlaneStatus.ps1", "utf8");

  assert.match(start, /dist\/server\.js/);
  assert.match(start, /tunnel-client/);
  assert.match(start, /EXECUTOR_TUNNEL_ID/);
  assert.match(start, /EXECUTOR_TUNNEL_API_SECRET/);
  assert.match(start, /EXECUTOR_CLIENT_TOKEN/);
  assert.match(start, /EXECUTOR_DEVICE_TOKENS_FILE/);
  assert.match(start, /EXECUTOR_EXECUTION_CAPACITY.*8/);
  assert.match(start, /EXECUTOR_LOGIC_CAPACITY.*64/);
  assert.match(start, /mcp session initialized/);
  assert.match(start, /\/readyz/);
  assert.equal(/EXECUTOR_DEVICE_ID/.test(start), false);
  assert.equal(/EXECUTOR_INSTALL_ROOT/.test(start), false);
  assert.equal(/EXECUTOR_TRUSTED_MANIFEST_SHA256/.test(start), false);

  const stateBlock = start.match(/\[pscustomobject\]@\{([\s\S]*?)\}\s*\|\s*ConvertTo-Json/i)?.[1] ?? "";
  assert.ok(stateBlock.length > 0, "control-plane state object not found");
  assert.match(stateBlock, /server_pid/);
  assert.match(stateBlock, /tunnel_pid/);
  assert.equal(/device_pid/i.test(stateBlock), false);
  assert.equal(/API_SECRET|API_KEY|CLIENT_TOKEN|DEVICE_TOKEN/i.test(stateBlock), false);

  assert.match(stop, /Win32_Process/);
  assert.match(stop, /CommandLine/);
  assert.match(restart, /Stop-ExecutorControlPlane/);
  assert.match(restart, /Start-ExecutorControlPlane/);
  assert.match(status, /\/health/);
  assert.match(status, /\/readyz/);
});
