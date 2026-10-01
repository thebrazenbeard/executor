import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("device agent supports an operator-owned CA for direct WSS", async () => {
  const agent = await readFile("src/device-agent.ts", "utf8");
  assert.match(agent, /EXECUTOR_DEVICE_CA_FILE/);
  assert.match(agent, /WebSocket[\s\S]*ca\s*:/);
});

test("Caddy bootstrap uses official GitHub release assets and SHA-512 verification", async () => {
  const installer = await readFile("scripts/Install-ExecutorCaddy.ps1", "utf8");
  assert.match(installer, /api\.github\.com\/repos\/caddyserver\/caddy\/releases\/latest/i);
  assert.match(installer, /caddyserver\/caddy\/releases/i);
  assert.match(installer, /SHA512/i);
  assert.equal(/cloudflare|tailscale|ngrok/i.test(installer), false);
});

test("direct runtime has no traffic relay and fronts only device ingress", async () => {
  const start = await readFile("scripts/Start-ExecutorDirect.ps1", "utf8");
  const status = await readFile("scripts/Get-ExecutorDirectStatus.ps1", "utf8");
  const stop = await readFile("scripts/Stop-ExecutorDirect.ps1", "utf8");
  const restart = await readFile("scripts/Restart-ExecutorDirect.ps1", "utf8");

  assert.match(start, /Start-ExecutorControlPlane\.ps1/);
  assert.match(start, /Install-ExecutorCaddy\.ps1/);
  assert.match(start, /tls\s+internal/i);
  assert.match(start, /reverse_proxy\s+127\.0\.0\.1:/i);
  assert.match(start, /New-NetFirewallRule/);
  assert.match(start, /HNetCfg\.NATUPnP/);
  assert.match(start, /root\.crt/);
  assert.match(start, /New-ExecutorDeviceEnrollment\.ps1/);
  assert.equal(/cloudflare|tailscale|ngrok|tunnel\s+--url/i.test(start), false);

  const stateBlock = start.match(/\[pscustomobject\]@\{([\s\S]*?)\}\s*\|\s*ConvertTo-Json/i)?.[1] ?? "";
  assert.ok(stateBlock.length > 0);
  assert.match(stateBlock, /caddy_pid/);
  assert.match(stateBlock, /public_device_url/);
  assert.equal(/API_SECRET|API_KEY|CLIENT_TOKEN|DEVICE_TOKEN/i.test(stateBlock), false);

  assert.match(status, /Win32_Process/);
  assert.match(stop, /Win32_Process/);
  assert.match(restart, /Stop-ExecutorDirect/);
  assert.match(restart, /Start-ExecutorDirect/);
});

test("enrollment carries a public CA without changing device-token storage", async () => {
  const enroll = await readFile("scripts/New-ExecutorDeviceEnrollment.ps1", "utf8");
  const install = await readFile("scripts/Install-ExecutorDevice.ps1", "utf8");
  const launch = await readFile("scripts/Start-ExecutorInstalledDevice.ps1", "utf8");

  assert.match(enroll, /CaCertificatePath/);
  assert.match(enroll, /CaCertificateBase64/);
  assert.match(install, /CaCertificateBase64/);
  assert.match(install, /device-ca\.crt/);
  assert.match(install, /ca_path/);
  assert.match(launch, /EXECUTOR_DEVICE_CA_FILE/);
  assert.match(install, /device-token\.dpapi/);
});

test("direct reachability tool exists and does not invoke a relay service", async () => {
  const probe = await readFile("scripts/Test-ExecutorDirectReachability.ps1", "utf8");
  assert.match(probe, /--cacert|CaCertificatePath/);
  assert.match(probe, /\/health/);
  assert.equal(/cloudflare|tailscale|ngrok/i.test(probe), false);
});
