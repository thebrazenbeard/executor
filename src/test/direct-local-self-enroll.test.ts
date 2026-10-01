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
