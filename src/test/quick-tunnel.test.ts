import test from "node:test";
import assert from "node:assert/strict";
import { extractTryCloudflareUrl } from "../quick-tunnel.js";

test("extracts only a public HTTPS TryCloudflare URL", () => {
  const log = `
2026-10-01 INF Requesting new quick Tunnel on trycloudflare.com...
2026-10-01 INF |  https://warm-breeze-123.trycloudflare.com  |
`;
  assert.equal(extractTryCloudflareUrl(log), "https://warm-breeze-123.trycloudflare.com");
});

test("rejects unsafe or unrelated tunnel URLs", () => {
  assert.equal(extractTryCloudflareUrl("http://bad.trycloudflare.com"), undefined);
  assert.equal(extractTryCloudflareUrl("https://example.com"), undefined);
  assert.equal(extractTryCloudflareUrl("https://user:pass@x.trycloudflare.com"), undefined);
  assert.equal(extractTryCloudflareUrl("https://trycloudflare.com.evil.example"), undefined);
});
