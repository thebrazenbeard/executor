import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("control-plane enrollment creates a per-device credential and copyable bootstrap", async () => {
  const script = await readFile("scripts/New-ExecutorDeviceEnrollment.ps1", "utf8");
  assert.match(script, /RandomNumberGenerator/);
  assert.match(script, /EXECUTOR_DEVICE_TOKENS_FILE|CredentialFile/);
  assert.match(script, /Move-Item|Replace/);
  assert.match(script, /Install-ExecutorDevice\.ps1/);
  assert.match(script, /DeviceServiceUrl/);
  assert.equal(/TUNNEL_API_SECRET|CONTROL_PLANE_API_KEY/.test(script), false);
});

test("Windows laptop installer protects only the device credential locally and starts the agent", async () => {
  const install = await readFile("scripts/Install-ExecutorDevice.ps1", "utf8");
  const start = await readFile("scripts/Start-ExecutorInstalledDevice.ps1", "utf8");

  assert.match(install, /ServiceUrl/);
  assert.match(install, /DeviceId/);
  assert.match(install, /DeviceToken/);
  assert.match(install, /Install-ExecutorDesktopCommander\.ps1/);
  assert.match(install, /npm[\s\S]*install[\s\S]*--ignore-scripts/i);
  assert.equal(/npm\s+ci\b/i.test(install), false);
  assert.match(install, /npm.*build|npm[\s\S]*run build/);
  assert.match(install, /ConvertFrom-SecureString/);
  assert.match(install, /Register-ScheduledTask|schtasks/i);
  assert.match(install, /Start-ScheduledTask|Start-Process/);
  assert.equal(/EXECUTOR_TUNNEL_ID|EXECUTOR_TUNNEL_API_SECRET|CONTROL_PLANE_API_KEY/.test(install), false);

  const configBlock = install.match(/\[ordered\]@\{([\s\S]*?)\}\s*\|\s*ConvertTo-Json/i)?.[1] ?? "";
  assert.ok(configBlock.length > 0, "device config object not found");
  assert.equal(/DeviceToken|token\s*=/.test(configBlock), false);

  assert.match(start, /ConvertTo-SecureString/);
  assert.match(start, /PtrToStringBSTR|SecureStringToBSTR/);
  assert.match(start, /EXECUTOR_SERVICE_URL/);
  assert.match(start, /EXECUTOR_DEVICE_ID/);
  assert.match(start, /EXECUTOR_DEVICE_TOKEN/);
  assert.match(start, /EXECUTOR_TRUSTED_MANIFEST_SHA256/);
  assert.match(start, /dist[\\/]device-agent\.js/);
  assert.match(start, /Start-Process/);
  assert.match(start, /RedirectStandardOutput/);
  assert.match(start, /RedirectStandardError/);
  assert.match(start, /System\.Threading\.Mutex/i);
  assert.match(start, /WaitOne\s*\(\s*0/i);
  assert.match(start, /ReleaseMutex/i);
  assert.equal(/&\s*\$node\s+\$agent\s+\*>>/i.test(start), false);
});
