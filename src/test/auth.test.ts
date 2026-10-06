import test from "node:test";
import assert from "node:assert/strict";
import { bearerAuthorized, tokenAuthorized } from "../auth.js";

test("client bearer authorization accepts only the configured secret", () => {
  assert.equal(bearerAuthorized("Bearer alpha", "alpha"), true);
  assert.equal(bearerAuthorized("Bearer beta", "alpha"), false);
  assert.equal(bearerAuthorized(undefined, "alpha"), false);
});

test("device token authorization requires an exact match", () => {
  assert.equal(tokenAuthorized("device-secret", "device-secret"), true);
  assert.equal(tokenAuthorized("device-secret-2", "device-secret"), false);
});


test("per-device tokens bind credentials to workstation identity while preserving optional shared fallback", async () => {
  const { parseDeviceTokens, deviceTokenAuthorized } = await import("../auth.js");
  const tokens = parseDeviceTokens('{"lappy":"lappy-secret","vera":"vera-secret"}');

  assert.equal(deviceTokenAuthorized("lappy", "lappy-secret", "shared-secret", tokens), true);
  assert.equal(deviceTokenAuthorized("lappy", "shared-secret", "shared-secret", tokens), false);
  assert.equal(deviceTokenAuthorized("other", "shared-secret", "shared-secret", tokens), true);
  assert.equal(deviceTokenAuthorized("other", "anything", "", tokens), false);

  const bomTokens = parseDeviceTokens("\uFEFF{\"lappy\":\"lappy-secret\"}");
  assert.equal(deviceTokenAuthorized("lappy", "lappy-secret", "", bomTokens), true);
});

test("per-device token configuration rejects malformed identities and secrets", async () => {
  const { parseDeviceTokens } = await import("../auth.js");
  assert.throws(() => parseDeviceTokens("{bad json"), /JSON/);
  assert.throws(() => parseDeviceTokens('{"../bad":"secret"}'), /device id/i);
  assert.throws(() => parseDeviceTokens('{"lappy":""}'), /token/i);
});
