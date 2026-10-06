import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("installed device endpoint can be repointed without replacing its identity or credential", async () => {
  const script = await readFile("scripts/Set-ExecutorInstalledDeviceEndpoint.ps1", "utf8");
  assert.match(script, /device\.json/);
  assert.match(script, /ServiceUrl/);
  assert.match(script, /https/i);
  assert.match(script, /loopback|localhost|127\.0\.0\.1/i);
  assert.match(script, /Start-ScheduledTask|Stop-ScheduledTask/);
  assert.equal(/device-token\.dpapi.*Set-Content|Set-Content.*device-token\.dpapi/s.test(script), false);
});

test("new enrollment prefers the exact local git HEAD instead of a mutable branch", async () => {
  const script = await readFile("scripts/New-ExecutorDeviceEnrollment.ps1", "utf8");
  assert.match(script, /git.*rev-parse.*HEAD|rev-parse.*HEAD.*git/s);
  assert.match(script, /[0-9a-f].*40|\{40\}/i);
  assert.match(script, /SourceRef/);
});
