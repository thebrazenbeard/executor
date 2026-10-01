import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("zero-cost cloudflared installer uses only the official binary and validates Windows signature", async () => {
  const installer = await readFile("scripts/Install-ExecutorCloudflared.ps1", "utf8");
  assert.match(installer, /github\.com\/cloudflare\/cloudflared\/releases\/latest\/download/i);
  assert.match(installer, /Get-AuthenticodeSignature/);
  assert.match(installer, /Status.*Valid|Valid.*Status/s);
  assert.match(installer, /Cloudflare/i);
  assert.equal(/tunnel\s+(create|login|route)|account|billing|workers/i.test(installer), false);
});

test("zero-cost quickstart lifecycle exposes only device ingress and persists no credentials", async () => {
  const start = await readFile("scripts/Start-ExecutorZeroCost.ps1", "utf8");
  const status = await readFile("scripts/Get-ExecutorZeroCostStatus.ps1", "utf8");
  const stop = await readFile("scripts/Stop-ExecutorZeroCost.ps1", "utf8");
  const restart = await readFile("scripts/Restart-ExecutorZeroCost.ps1", "utf8");

  assert.match(start, /Start-ExecutorControlPlane\.ps1/);
  assert.match(start, /Install-ExecutorCloudflared\.ps1/);
  assert.match(start, /127\.0\.0\.1.*8788|EXECUTOR_DEVICE_PORT/s);
  assert.match(start, /cloudflared/);
  assert.match(start, /tunnel.*--url|--url.*8788/s);
  assert.match(start, /trycloudflare\.com/);
  assert.match(start, /role.*device-ingress|device-ingress.*role/s);
  assert.match(start, /New-ExecutorDeviceEnrollment\.ps1/);
  assert.equal(/tunnel\s+(create|login|route)|named tunnel|workers deploy/i.test(start), false);

  const stateBlock = start.match(/\[pscustomobject\]@\{([\s\S]*?)\}\s*\|\s*ConvertTo-Json/i)?.[1] ?? "";
  assert.ok(stateBlock.length > 0, "zero-cost state object not found");
  assert.match(stateBlock, /quick_tunnel_pid/);
  assert.match(stateBlock, /public_device_url/);
  assert.equal(/API_SECRET|API_KEY|CLIENT_TOKEN|DEVICE_TOKEN/i.test(stateBlock), false);

  assert.match(status, /Win32_Process/);
  assert.match(status, /CommandLine/);
  assert.match(status, /\/health/);
  assert.match(stop, /Win32_Process/);
  assert.match(stop, /CommandLine/);
  assert.match(restart, /Stop-ExecutorZeroCost/);
  assert.match(restart, /Start-ExecutorZeroCost/);
});
