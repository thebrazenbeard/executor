import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function runWindowsBootstrap(runtime: string, taskName: string) {
  return spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    resolve("scripts", "Install-ExecutorDevice.ps1"),
    "-ServiceUrl", "https://example.invalid", "-DeviceId", "test-device",
    "-DeviceToken", "synthetic-test-token", "-RuntimeRoot", runtime,
    "-AgentRoot", join(runtime, "Agent"),
    "-PayloadRoot", join(runtime, "DesktopCommanderMCP"), "-TaskName", taskName,
  ], { encoding: "utf8", timeout: 15000 });
}

function runWindowsPowerShell(code: string) {
  return spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", code,
  ], { encoding: "utf8", timeout: 15000 });
}

test("device agent supports an operator-owned CA for direct WSS", async () => {
  const agent = await readFile("src/device-agent.ts", "utf8");
  assert.match(agent, /EXECUTOR_DEVICE_CA_FILE/);
  assert.match(agent, /EXECUTOR_DEVICE_TLS_SERVER_NAME/);
  assert.match(agent, /WebSocket[\s\S]*ca\s*:/);
  assert.match(agent, /servername/);
  assert.match(agent, /headers[\s\S]*Host/);
});

test("Caddy bootstrap uses official GitHub release assets and SHA-512 verification", async () => {
  const installer = await readFile("scripts/Install-ExecutorCaddy.ps1", "utf8");
  assert.equal(/api\.github\.com/i.test(installer), false);
  assert.match(installer, /github\.com\/caddyserver\/caddy\/releases\/latest/i);
  assert.match(installer, /url_effective|Location/i);
  assert.match(installer, /caddyserver\/caddy\/releases/i);
  assert.match(installer, /SHA512/i);
  assert.equal(/cloudflare|tailscale|ngrok/i.test(installer), false);
});

test("direct runtime has no traffic relay and fronts only device ingress", async () => {
  const start = await readFile("scripts/Start-ExecutorDirect.ps1", "utf8");
  const status = await readFile("scripts/Get-ExecutorDirectStatus.ps1", "utf8");
  const stop = await readFile("scripts/Stop-ExecutorDirect.ps1", "utf8");
  const restart = await readFile("scripts/Restart-ExecutorDirect.ps1", "utf8");

  assert.match(start, /Start-ExecutorControlPlane\.ps1/);
  assert.match(start, /Install-ExecutorCaddy\.ps1/);
  assert.match(start, /TlsServerName/i);
  assert.match(start, /executor-device\.invalid/i);
  assert.match(start, /tls\s+internal/i);
  assert.match(start, /skip_install_trust/i);
  assert.match(start, /reverse_proxy\s+127\.0\.0\.1:/i);
  assert.match(start, /New-NetFirewallRule/);
  assert.match(start, /HNetCfg\.NATUPnP/);
  assert.match(start, /root\.crt/);
  assert.match(start, /probe-device-ingress\.mjs/i);
  assert.equal(/ssl-revoke-best-effort|--cacert/i.test(start), false);
  assert.match(start, /StaticPortMappingCollection[\s\S]*Remove\(/i);
  assert.match(start, /New-ExecutorDeviceEnrollment\.ps1/);
  assert.equal(/cloudflare|tailscale|ngrok|tunnel\s+--url/i.test(start), false);
  assert.equal(/function\s+(NV|SP)\b/i.test(start), false, "direct runtime helper names must not collide with PowerShell aliases");

  const stateBlock = start.match(/\[pscustomobject\]@\{([\s\S]*?)\}\s*\|\s*ConvertTo-Json/i)?.[1] ?? "";
  assert.ok(stateBlock.length > 0);
  assert.match(stateBlock, /caddy_pid/);
  assert.match(stateBlock, /public_device_url/);
  assert.equal(/API_SECRET|API_KEY|CLIENT_TOKEN|DEVICE_TOKEN/i.test(stateBlock), false);

  assert.match(status, /Win32_Process/);
  assert.match(stop, /Win32_Process/);
  assert.match(restart, /Stop-ExecutorDirect/);
  assert.match(restart, /Start-ExecutorDirect/);
});

test("enrollment carries a public CA without changing device-token storage", async () => {
  const enroll = await readFile("scripts/New-ExecutorDeviceEnrollment.ps1", "utf8");
  const install = await readFile("scripts/Install-ExecutorDevice.ps1", "utf8");
  const launch = await readFile("scripts/Start-ExecutorInstalledDevice.ps1", "utf8");

  assert.match(enroll, /CaCertificatePath/);
  assert.match(enroll, /CaCertificateBase64/);
  assert.match(install, /CaCertificateBase64/);
  assert.match(install, /device-ca\.crt/);
  assert.match(install, /ca_path/);
  assert.match(enroll, /TlsServerName/);
  assert.match(install, /TlsServerName/);
  assert.match(install, /tls_server_name/);
  assert.match(launch, /EXECUTOR_DEVICE_CA_FILE/);
  assert.match(launch, /EXECUTOR_DEVICE_TLS_SERVER_NAME/);
  assert.match(install, /device-token\.dpapi/);
});

test("direct reachability tool exists and does not invoke a relay service", async () => {
  const probe = await readFile("scripts/Test-ExecutorDirectReachability.ps1", "utf8");
  assert.match(probe, /CaCertificatePath/);
  assert.match(probe, /probe-device-ingress\.mjs/i);
  assert.match(probe, /resolve-to-loopback/i);
  assert.equal(/ssl-revoke-best-effort|--cacert/i.test(probe), false);
  assert.equal(/cloudflare|tailscale|ngrok/i.test(probe), false);
});

test("Windows CI exercises a real Caddy TLS + WSS device route", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const qualifier = await readFile("scripts/qualify-direct-ingress.ps1", "utf8");
  const probe = await readFile("scripts/qualify-direct-ingress.mjs", "utf8");
  assert.match(workflow, /qualify-direct-ingress\.ps1/);
  assert.match(qualifier, /Install-ExecutorCaddy\.ps1/);
  assert.match(qualifier, /tls\s+internal/i);
  assert.match(probe, /new WebSocket/);
  assert.match(probe, /servername/);
  assert.match(probe, /Host/);
  assert.match(probe, /deviceHello/);
});


test("Node direct-ingress probe verifies CA, health role, and optional loopback resolution", async () => {
  const probe = await readFile("scripts/probe-device-ingress.mjs", "utf8");
  assert.match(probe, /node:https|from "https"|from 'https'/i);
  assert.match(probe, /rejectUnauthorized\s*:\s*true/i);
  assert.match(probe, /checkServerIdentity|hostname|host/i);
  assert.match(probe, /127\.0\.0\.1/);
  assert.match(probe, /device-ingress/i);
  assert.equal(/rejectUnauthorized\s*:\s*false/i.test(probe), false);
});


test("Windows direct qualifier falls back to a normal temp directory outside GitHub Actions", async () => {
  const qualifier = await readFile("scripts/qualify-direct-ingress.ps1", "utf8");
  assert.match(qualifier, /RUNNER_TEMP/);
  assert.match(qualifier, /\$env:TEMP|GetTempPath/i);
});


test("direct runtime validates an existing router mapping before treating it as owned", async () => {
  const start = await readFile("scripts/Start-ExecutorDirect.ps1", "utf8");
  assert.match(start, /ExternalPort/i);
  assert.match(start, /InternalClient/i);
  assert.match(start, /InternalPort/i);
  assert.match(start, /Description/i);
  assert.match(start, /mapping conflict/i);
});

test("Windows device installer refuses an existing runtime without terminating processes or replacing credentials", async () => {
  const install = await readFile("scripts/Install-ExecutorDevice.ps1", "utf8");

  assert.match(install, /function\s+Assert-FreshInstallTargets/i);
  assert.match(install, /EXISTING_EXECUTOR_INSTALL/i);
  assert.equal(/Stop-ExistingInstalledDeviceProcesses|Stop-Process\s+-Id|Stop-ScheduledTask/i.test(install), false);
  assert.equal(/Remove-Item[^\n]*\$backup|AgentRoot\.backup\./i.test(install), false);
  assert.match(install, /FileMode\]::CreateNew/i);

  const initialGuard = install.search(/^Assert-FreshInstallTargets\r?$/m);
  const firstClone = install.indexOf("& $git clone");
  const firstCredentialWrite = install.indexOf("WriteNewFileBytes -Path $credentialPath");
  assert.ok(initialGuard > 0 && initialGuard < firstClone, "existing installation must be rejected before cloning");
  assert.ok(install.replace(/\r?\n/g, "\r\n").search(/^Assert-FreshInstallTargets\r?$/m) > 0,
    "the safety guard must be found under Windows CRLF checkout");
  assert.ok(firstCredentialWrite > firstClone, "new credential is only written for a fresh install after source qualification");
  assert.match(install, /Install-ExecutorDesktopCommander\.ps1"\) -InstallRoot \$payloadCandidate/);
  assert.match(install, /\[IO\.Directory\]::Move\(\$payloadCandidate,\$PayloadRoot\)/);
  assert.equal(/Register-ScheduledTask[^\n]*-Force/.test(install), false);
});

test("Windows bootstrap refuses an existing agent before any file/process/task mutation", { skip: process.platform !== "win32" }, async () => {
  const runtime = await mkdtemp(join(tmpdir(), "executor-fresh-only-test-"));
  const agent = join(runtime, "Agent");
  const payload = join(runtime, "DesktopCommanderMCP");
  const token = join(runtime, "device-token.dpapi");
  const config = join(runtime, "device.json");
  const marker = join(agent, "owner-marker.txt");
  const taskName = `Executor FreshOnly Test ${randomUUID()}`;
  try {
    await mkdir(agent);
    await writeFile(marker, "owned agent: must remain untouched\n");
    await writeFile(token, "owned credentials: must remain untouched\n");
    await writeFile(config, "owned config: must remain untouched\n");

    const result = runWindowsBootstrap(runtime, taskName);

    assert.equal(result.error, undefined, String(result.error));
    assert.notEqual(result.status, 0, "existing runtime must fail closed");
    assert.match(`${result.stdout}\n${result.stderr}`, /EXISTING_EXECUTOR_INSTALL/);
    assert.equal(await readFile(marker, "utf8"), "owned agent: must remain untouched\n");
    assert.equal(await readFile(token, "utf8"), "owned credentials: must remain untouched\n");
    assert.equal(await readFile(config, "utf8"), "owned config: must remain untouched\n");
    await assert.rejects(readFile(join(runtime, "DesktopCommanderMCP", "executor-desktop-commander.manifest.json")));
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test("Windows bootstrap refuses a payload-only collision without touching the existing payload", { skip: process.platform !== "win32" }, async () => {
  const runtime = await mkdtemp(join(tmpdir(), "executor-payload-only-test-"));
  const payload = join(runtime, "DesktopCommanderMCP");
  const marker = join(payload, "owner-marker.txt");
  const taskName = `Executor FreshOnly Test ${randomUUID()}`;
  try {
    await mkdir(payload);
    await writeFile(marker, "owned payload: must remain untouched\n");

    const result = runWindowsBootstrap(runtime, taskName);
    assert.equal(result.error, undefined, String(result.error));
    assert.notEqual(result.status, 0, "existing payload must fail closed");
    assert.match(`${result.stdout}\n${result.stderr}`, /EXISTING_EXECUTOR_INSTALL/);
    assert.equal(await readFile(marker, "utf8"), "owned payload: must remain untouched\n");
    assert.deepEqual(await readdir(runtime), ["DesktopCommanderMCP"]);
    assert.deepEqual(await readdir(payload), ["owner-marker.txt"]);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});

test("Windows bootstrap refuses a task-only collision and preserves that exact task", { skip: process.platform !== "win32" }, async () => {
  const runtime = await mkdtemp(join(tmpdir(), "executor-task-only-test-"));
  const taskName = `Executor FreshOnly Test ${randomUUID()}`;
  const ownerMarker = `EXECUTOR_TEST_OWNED_${randomUUID()}`;
  // Names and descriptions are generated locally and contain no shell metacharacters.
  const setup = `$ErrorActionPreference='Stop'; $action=New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'; $trigger=New-ScheduledTaskTrigger -Once -At ((Get-Date).AddDays(30)); Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Description '${ownerMarker}' | Out-Null; Write-Output 'SYNTHETIC_TASK_REGISTERED'`;
  const verify = `$ErrorActionPreference='Stop'; $task=Get-ScheduledTask -TaskName '${taskName}' -ErrorAction Stop; if($task.Description -ne '${ownerMarker}'){throw 'SYNTHETIC_TASK_CHANGED'}; Write-Output 'SYNTHETIC_TASK_UNCHANGED'`;
  const cleanup = `$ErrorActionPreference='Stop'; $task=Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; if($null -ne $task){if($task.Description -ne '${ownerMarker}'){throw 'REFUSING_UNOWNED_TASK_CLEANUP'}; Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false; Write-Output 'SYNTHETIC_TASK_REMOVED'}`;
  try {
    const registered = runWindowsPowerShell(setup);
    assert.equal(registered.error, undefined, String(registered.error));
    assert.equal(registered.status, 0, `test-task setup failed: ${registered.stderr}`);
    assert.match(registered.stdout, /SYNTHETIC_TASK_REGISTERED/);

    const refusal = runWindowsBootstrap(runtime, taskName);
    assert.equal(refusal.error, undefined, String(refusal.error));
    assert.notEqual(refusal.status, 0, "existing scheduled task must fail closed");
    assert.match(`${refusal.stdout}\n${refusal.stderr}`, /EXISTING_EXECUTOR_INSTALL/);
    assert.deepEqual(await readdir(runtime), [], "refusal must not create agent, payload, config, or credentials");

    const preserved = runWindowsPowerShell(verify);
    assert.equal(preserved.error, undefined, String(preserved.error));
    assert.equal(preserved.status, 0, `synthetic task changed: ${preserved.stderr}`);
    assert.match(preserved.stdout, /SYNTHETIC_TASK_UNCHANGED/);
  } finally {
    // Never unregister any existing task unless its original test-owned description matches.
    try {
      const removed = runWindowsPowerShell(cleanup);
      assert.equal(removed.status, 0, `test-owned task cleanup failed: ${removed.stderr}`);
    } finally {
      await rm(runtime, { recursive: true, force: true });
    }
  }
});
