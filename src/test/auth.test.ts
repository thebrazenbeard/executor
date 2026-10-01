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
