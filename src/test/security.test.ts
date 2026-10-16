import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isOriginAllowed, assertSafeDeviceServiceUrl, resolveInsideRoot, trustedSha256Matches } from "../security.js";

test("origin allowlist permits absent non-browser origin and exact configured origins", () => {
  assert.equal(isOriginAllowed(undefined, ["https://chatgpt.com"]), true);
  assert.equal(isOriginAllowed("https://chatgpt.com", ["https://chatgpt.com"]), true);
  assert.equal(isOriginAllowed("https://evil.example", ["https://chatgpt.com"]), false);
});

test("device transport requires TLS except explicit loopback development", () => {
  assert.doesNotThrow(() => assertSafeDeviceServiceUrl(new URL("https://executor.example")));
  assert.doesNotThrow(() => assertSafeDeviceServiceUrl(new URL("http://127.0.0.1:8787")));
  assert.throws(() => assertSafeDeviceServiceUrl(new URL("http://executor.example")), /TLS/);
});

test("manifest relative paths cannot escape the qualified install root", () => {
  const root = path.resolve("qualified-root");
  assert.equal(resolveInsideRoot(root, "dist/index.js"), path.resolve(root, "dist/index.js"));
  assert.throws(() => resolveInsideRoot(root, "../outside"), /escapes/);
  assert.throws(() => resolveInsideRoot(root, path.resolve(root, "..", "outside")), /relative/);
});

test("manifest trust anchor requires an exact SHA-256 digest", () => {
  const digest = "a".repeat(64);
  assert.equal(trustedSha256Matches(digest, digest.toUpperCase()), true);
  assert.equal(trustedSha256Matches(digest, "b".repeat(64)), false);
  assert.equal(trustedSha256Matches(digest, "not-a-digest"), false);
});
