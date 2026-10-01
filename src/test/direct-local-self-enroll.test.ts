import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("direct runtime can enroll the host machine without exposing the device token to shell history", async () => {
  const start = await readFile("scripts/Start-ExecutorDirect.ps1", "utf8");
  const enroll = await readFile("scripts/New-ExecutorDeviceEnrollment.ps1", "utf8");

  assert.match(start, /InstallLocalDevice/);
  assert.match(start, /127\.0\.0\.1.*PublicPort|localDeviceUrl/s);
  assert.match(start, /InstallLocal/);
  assert.match(start, /connectedDeviceCount/);

  assert.match(enroll, /\[switch\]\$InstallLocal/);
  assert.match(enroll, /Install-ExecutorDevice\.ps1/);
  assert.match(enroll, /-DeviceToken\s+\$token/);
  assert.equal(/Invoke-Expression|iex/i.test(enroll), false);
});

test("direct Caddy config issues an internal certificate for local self-enrollment as well as public ingress", async () => {
  const start = await readFile("scripts/Start-ExecutorDirect.ps1", "utf8");
  assert.match(start, /127\.0\.0\.1/);
  assert.match(start, /tls\s+internal/i);
  assert.match(start, /reverse_proxy\s+127\.0\.0\.1:/i);
});


test("direct runtime owns dedicated private ports and generates its tunnel profile", async () => {
  const start = await readFile("scripts/Start-ExecutorDirect.ps1", "utf8");
  const restart = await readFile("scripts/Restart-ExecutorDirect.ps1", "utf8");

  assert.match(start, /\[int\]\$McpPort\s*=\s*18887/i);
  assert.match(start, /\[int\]\$DevicePort\s*=\s*18888/i);
  assert.match(start, /direct-tunnel-profile\.yaml/i);
  assert.match(start, /127\.0\.0\.1:\$McpPort\/mcp|127\.0\.0\.1:\$\(\$McpPort\)\/mcp/i);
  assert.match(start, /\$env:PORT\s*=\s*\[string\]\$McpPort|\$env:PORT\s*=\s*"?\$McpPort/i);
  assert.match(start, /\$env:EXECUTOR_DEVICE_PORT\s*=\s*\[string\]\$DevicePort|\$env:EXECUTOR_DEVICE_PORT\s*=\s*"?\$DevicePort/i);
  assert.match(start, /local_mcp_port/i);
  assert.match(restart, /McpPort/i);
  assert.match(restart, /DevicePort/i);
});


test("local self-enrollment never emits a credential-bearing bootstrap command", async () => {
  const enroll = await readFile("scripts/New-ExecutorDeviceEnrollment.ps1", "utf8");
  assert.match(enroll, /bootstrap_command\s*=\s*if\s*\(\$InstallLocal\)\s*\{\s*\$null\s*\}/i);
});
