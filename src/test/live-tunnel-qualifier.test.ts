import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

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
  assert.match(script, /newProbeCommand\(probeTemplate, index\)/);
  assert.match(script, /hasExactProbeOutput\(result, marker\)/);
  assert.match(script, /operationBoundStdoutReceipts/);
  assert.match(script, /AUTHENTICATED_LOCAL_SHARED_COUNTERS_NOT_PER_OPERATION_ATTESTATION/);
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
  assert.match(setup, /\{probe_nonce\}/);
  assert.match(setup, /neither independently authenticates the host process owner/i);
});


test("operation-bound stdout proof rejects bare success, mismatched commands and fabricated fields", () => {
  // Exercise the actual pure helper in a separate module process; no remote
  // endpoint, device, credentials, or host process is contacted.
  const source = String.raw`
import assert from "node:assert/strict";
import { newProbeCommand, hasExactProbeOutput } from "./scripts/probe-receipt.mjs";
const first = newProbeCommand('powershell -Command "Write-Output {probe_nonce}"', 7);
const second = newProbeCommand('powershell -Command "Write-Output {probe_nonce}"', 8);
assert.notEqual(first.marker, second.marker);
assert.match(first.command, new RegExp(first.marker));
assert.match(first.marker, /^EXECUTOR_START_PROCESS_7_[a-f0-9]{32}$/);
const good = { isError: false, content: [{type:"text",text:"Process started\nInitial output:\n"+first.marker+"\n"}] };
assert.equal(hasExactProbeOutput(good, first.marker), true);
assert.equal(hasExactProbeOutput(good, second.marker), false);
assert.equal(hasExactProbeOutput({ isError:false, content:[{type:"text",text:"operation accepted"}] }, first.marker), false);
assert.equal(hasExactProbeOutput({ isError:false, content:[{type:"text",text:"echo "+first.marker}] }, first.marker), false);
assert.equal(hasExactProbeOutput({ isError:true, content:[{type:"text",text:first.marker}] }, first.marker), false);
assert.equal(hasExactProbeOutput({ isError:false, structuredContent:{stdout:first.marker} }, first.marker), false);
assert.throws(() => newProbeCommand('echo static', 9), /exactly one/);
assert.throws(() => newProbeCommand('{probe_nonce} and {probe_nonce}', 9), /exactly one/);
assert.throws(() => newProbeCommand('echo {probe_nonce}', -1), /invalid probe/);
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    cwd: process.cwd()
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});


test("live tunnel qualifier does not echo the remote endpoint because it may contain credential-bearing query data", async () => {
  const script = await readFile("scripts/qualify-live-tunnel.mjs", "utf8");
  const outputBlock = script.match(/console\.log\(JSON\.stringify\(\{([\s\S]*?)\}\)\);/)?.[1] ?? "";
  assert.ok(outputBlock.length > 0, "qualification result block not found");
  assert.equal(/\bremoteMcpUrl\b/.test(outputBlock), false);
});


test("live tunnel qualifier rejects loopback or plaintext endpoints so local traffic cannot masquerade as tunnel proof", () => {
  const result = spawnSync(process.execPath, ["scripts/qualify-live-tunnel.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      EXECUTOR_REMOTE_MCP_URL: "http://127.0.0.1:1/mcp",
      EXECUTOR_REMOTE_DEVICE_ID: "qualification",
      EXECUTOR_CLIENT_TOKEN: "qualification-client"
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /non-loopback HTTPS remote MCP URL/i);
});
