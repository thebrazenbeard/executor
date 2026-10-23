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


test("device agent exposes safe websocket handshake state and bounds a stuck handshake", async () => {
  const agent = await readFile("src/device-agent.ts", "utf8");
  assert.match(agent, /handshakeTimeout\s*:\s*10_000/);
  assert.match(agent, /device-websocket-open/);
  assert.match(agent, /device-websocket-ready/);
});

test("device heartbeat source contract bounds half-open links without implying request success", async () => {
  // Source contract: importing the agent would verify a local manifest and spawn a payload.
  // A real peer-silence test remains required before deployment qualification.
  const agent = await readFile("src/device-agent.ts", "utf8");

  assert.match(agent, /socket\.on\("pong",\s*\(\)\s*=>\s*\{\s*awaitingPong = false;/);
  assert.match(agent, /socket\.once\("close",\s*\(\)\s*=>\s*\{\s*if \(heartbeat\) clearInterval\(heartbeat\);/);
  assert.match(agent, /if \(socket\.readyState !== WebSocket\.OPEN\) return;/);
  assert.match(agent, /if \(awaitingPong\)\s*\{[\s\S]*?device-heartbeat-timeout[\s\S]*?socket\.terminate\(\);/);
  assert.match(agent, /awaitingPong = true;\s*socket\.ping\(\);/);
  assert.match(agent, /\}, 15_000\);\s*heartbeat\.unref\(\);/);
  assert.match(agent, /request-outcome-unknown-after-disconnect/);
  assert.match(agent, /pendingOutbound\.clear\(\);[\s\S]*?setTimeout\(connect, delay\);/);
});
