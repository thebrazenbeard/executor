import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("live tunnel qualifier drives 64 routed calls without embedding credentials", async () => {
  const script = await readFile("scripts/qualify-live-tunnel.mjs", "utf8");

  assert.match(script, /EXECUTOR_REMOTE_MCP_URL/);
  assert.match(script, /EXECUTOR_REMOTE_AUTHORIZATION/);
  assert.match(script, /EXECUTOR_REMOTE_DEVICE_ID/);
  assert.match(script, /Array\.from\(\{ length: 64 \}/);
  assert.match(script, /start_process/);
  assert.match(script, /deviceId/);
  assert.match(script, /\/health/);
  assert.match(script, /maxExecutionActive/);
  assert.match(script, /maxLogicActive/);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(script), false);
});

test("live tunnel qualification remains opt-in and is not run by ordinary CI", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.equal(workflow.includes("qualify-live-tunnel.mjs"), false);
});
