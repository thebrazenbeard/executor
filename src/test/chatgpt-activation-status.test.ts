import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ChatGPT activation verifier proves tunnel readiness without emitting secrets", async () => {
  const script = await readFile("scripts/Get-ExecutorChatGPTActivationStatus.ps1", "utf8");

  assert.match(script, /Get-ExecutorControlPlaneStatus\.ps1/);
  assert.match(script, /mcp_session_verified/i);
  assert.match(script, /tunnel_ready/i);
  assert.match(script, /admin\s+--json\s+tunnels\s+get/i);
  assert.match(script, /ready_for_chatgpt_activation/i);
  assert.match(script, /tunnel_id/i);
  assert.match(script, /tunnel_name/i);
  assert.match(script, /chatgpt_connection_method/i);
  assert.match(script, /Tunnel/);

  assert.equal(/Write-(Host|Output).*secret/i.test(script), false);
  assert.equal(/ConvertTo-Json.*secret/i.test(script), false);
  assert.equal(/Set-Content.*secret/i.test(script), false);
  assert.equal(/Add-Content.*secret/i.test(script), false);
});
