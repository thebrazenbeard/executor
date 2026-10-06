import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("headless control plane starts server plus tunnel without requiring a local workstation", async () => {
  const start = await readFile("scripts/Start-ExecutorControlPlane.ps1", "utf8");
  const stop = await readFile("scripts/Stop-ExecutorControlPlane.ps1", "utf8");
  const restart = await readFile("scripts/Restart-ExecutorControlPlane.ps1", "utf8");
  const status = await readFile("scripts/Get-ExecutorControlPlaneStatus.ps1", "utf8");

  assert.match(start, /dist\/server\.js/);
  assert.match(start, /tunnel-client/);
  assert.match(start, /EXECUTOR_TUNNEL_ID/);
  assert.match(start, /EXECUTOR_TUNNEL_API_SECRET/);
  assert.match(start, /EXECUTOR_CLIENT_TOKEN/);
  assert.match(start, /EXECUTOR_DEVICE_TOKENS_FILE/);
  assert.match(start, /EXECUTOR_EXECUTION_CAPACITY.*8/);
  assert.match(start, /EXECUTOR_LOGIC_CAPACITY.*64/);
  assert.match(start, /mcp session initialized/);
  assert.match(start, /\/readyz/);
  assert.equal(/EXECUTOR_DEVICE_ID/.test(start), false);
  assert.equal(/EXECUTOR_INSTALL_ROOT/.test(start), false);
  assert.equal(/EXECUTOR_TRUSTED_MANIFEST_SHA256/.test(start), false);

  const stateBlock = start.match(/\[pscustomobject\]@\{([\s\S]*?)\}\s*\|\s*ConvertTo-Json/i)?.[1] ?? "";
  assert.ok(stateBlock.length > 0, "control-plane state object not found");
  assert.match(stateBlock, /server_pid/);
  assert.match(stateBlock, /tunnel_pid/);
  assert.equal(/device_pid/i.test(stateBlock), false);
  assert.equal(/API_SECRET|API_KEY|CLIENT_TOKEN|DEVICE_TOKEN/i.test(stateBlock), false);

  assert.match(stop, /Win32_Process/);
  assert.match(stop, /CommandLine/);
  assert.match(restart, /Stop-ExecutorControlPlane/);
  assert.match(restart, /Start-ExecutorControlPlane/);
  assert.match(status, /\/health/);
  assert.match(status, /\/readyz/);
});

test("control plane can bootstrap the official OpenAI tunnel-client when it is not on PATH", async () => {
  const installer = await readFile("scripts/Install-ExecutorTunnelClient.ps1", "utf8");
  const start = await readFile("scripts/Start-ExecutorControlPlane.ps1", "utf8");
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  assert.equal(/api\.github\.com/i.test(installer), false);
  assert.match(installer, /github\.com\/openai\/tunnel-client\/releases\/latest/i);
  assert.match(installer, /url_effective|Location/i);
  assert.match(installer, /SHA256SUMS\.txt/);
  assert.match(installer, /Get-FileHash[^\n]*SHA256|SHA256[\s\S]*Get-FileHash/i);
  assert.match(installer, /"X64"\s*\{\s*\$assetArch\s*=\s*"amd64"/i);
  assert.match(installer, /"Arm64"\s*\{\s*\$assetArch\s*=\s*"arm64"/i);
  assert.match(installer, /tunnel-client-v\{0\}-windows-\{1\}\.zip/i);
  assert.match(start, /Install-ExecutorTunnelClient\.ps1/);
  assert.match(start, /Get-Command[^\n]*TunnelClient[\s\S]*SilentlyContinue/i);
  assert.match(workflow, /Install-ExecutorTunnelClient\.ps1/);
  assert.match(workflow, /help quickstart/i);
});

test("control-plane restart recovers the existing direct runtime without recreating network edges", async () => {
  const restart = await readFile("scripts/Restart-ExecutorControlPlane.ps1", "utf8");

  assert.match(restart, /direct-state\.json/i);
  assert.match(restart, /credential_file/i);
  assert.match(restart, /tunnel_profile_path/i);
  assert.match(restart, /local_mcp_port/i);
  assert.match(restart, /local_device_port/i);
  assert.match(restart, /device\.json/i);
  assert.match(restart, /EXECUTOR_DEVICE_TOKENS_FILE/i);
  assert.match(restart, /EXECUTOR_CLIENT_TOKEN/i);
  assert.match(restart, /RandomNumberGenerator/i);
  assert.match(restart, /Stop-ExecutorControlPlane/i);
  assert.match(restart, /Start-ExecutorControlPlane/i);
  assert.equal(/Stop-ExecutorDirect|Start-ExecutorDirect|Remove-NetFirewallRule|StaticPortMappingCollection/i.test(restart), false);
  assert.equal(/Write-(Host|Output).*secret/i.test(restart), false);
});
