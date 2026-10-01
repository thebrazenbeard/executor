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


test("package and setup docs expose live tunnel qualification as an explicit operator action", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const setup = await readFile("docs/SETUP.md", "utf8");

  assert.equal(packageJson.scripts["qualify:live-tunnel"], "node scripts/qualify-live-tunnel.mjs");
  assert.match(setup, /qualify:live-tunnel/);
  assert.match(setup, /EXECUTOR_REMOTE_MCP_URL/);
  assert.match(setup, /EXECUTOR_REMOTE_DEVICE_ID/);
  assert.match(setup, /EXECUTOR_REMOTE_AUTHORIZATION/);
  assert.match(setup, /8 parallel execution lanes/i);
  assert.match(setup, /64 parallel logic lanes/i);
});


test("live tunnel qualifier does not echo the remote endpoint because it may contain credential-bearing query data", async () => {
  const script = await readFile("scripts/qualify-live-tunnel.mjs", "utf8");
  const outputBlock = script.match(/console\.log\(JSON\.stringify\(\{([\s\S]*?)\}\)\);/)?.[1] ?? "";
  assert.ok(outputBlock.length > 0, "qualification result block not found");
  assert.equal(/\bremoteMcpUrl\b/.test(outputBlock), false);
});
