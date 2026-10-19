import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const windows = process.platform === "win32";
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
function powershell(script: string) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 20000 });
}
test("startup dry run distinguishes sign-in from credential-bound unattended boot without registering a task",
  { skip: !windows, timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-startup-"));
  const task = "Executor-regression-" + Date.now();
  try {
    await mkdir(join(root, "agent/scripts"), { recursive: true });
    await writeFile(join(root, "agent/scripts/Start-ExecutorInstalledDevice.ps1"), "# fixture");
    await writeFile(join(root, "device.json"), JSON.stringify({
      schema: "EXECUTOR_INSTALLED_DEVICE_V1", agent_root: join(root, "agent"), task_name: task
    }));
    const invoke = "& " + quote(resolve("scripts/Set-ExecutorInstalledDeviceStartup.ps1")) +
      " -RuntimeRoot " + quote(root) + " -DryRun";
    const result = powershell(
      "$ErrorActionPreference='Stop';" +
      "$before=@(Get-ScheduledTask -TaskName " + quote(task) + " -ErrorAction SilentlyContinue).Count;" +
      "$logon=(" + invoke + ")|ConvertFrom-Json;" +
      "$credential=New-Object Management.Automation.PSCredential([Security.Principal.WindowsIdentity]::GetCurrent().Name,(ConvertTo-SecureString 'fixture-never-registered' -AsPlainText -Force));" +
      "$boot=(" + invoke + " -AtStartup -Credential $credential)|ConvertFrom-Json;" +
      "$rejected=$false;try{" + invoke + " -AtStartup}catch{$rejected=$true};" +
      "$after=@(Get-ScheduledTask -TaskName " + quote(task) + " -ErrorAction SilentlyContinue).Count;" +
      "@{logon=$logon;boot=$boot;missing_credential_rejected=$rejected;before=$before;after=$after}|ConvertTo-Json -Depth 5"
    );
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.logon.mode, "logon");
    assert.equal(data.logon.logon_type, "Interactive");
    assert.equal(data.boot.mode, "boot-and-logon");
    assert.equal(data.boot.logon_type, "Password");
    assert.equal(data.boot.execution_time_limit, "PT0S");
    assert.equal(data.boot.restart_count, 3);
    assert.equal(data.missing_credential_rejected, true);
    assert.equal(data.before, 0);
    assert.equal(data.after, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("installed launcher rejects an existing agent before decrypting a credential or creating another agent",
  { skip: !windows, timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-duplicate-"));
  let agent: ReturnType<typeof spawn> | undefined;
  try {
    const agentRoot = join(root, "agent");
    const agentPath = join(agentRoot, "dist/device-agent.js");
    await mkdir(join(agentRoot, "dist"), { recursive: true });
    await writeFile(agentPath, "console.log('FIXTURE_READY');setInterval(()=>{},1000)");
    await writeFile(join(root, "device.json"), JSON.stringify({
      schema: "EXECUTOR_INSTALLED_DEVICE_V1", device_id: "fixture", agent_root: agentRoot
    }));
    await writeFile(join(root, "device-token.dpapi"), "invalid-fixture-not-a-secret");
    agent = spawn(process.execPath, [agentPath], { stdio: ["ignore", "pipe", "pipe"] });
    await Promise.race([
      once(agent.stdout!, "data"),
      delay(5000).then(() => { throw new Error("fixture did not start"); })
    ]);
    const result = powershell("& " + quote(resolve("scripts/Start-ExecutorInstalledDevice.ps1")) +
      " -RuntimeRoot " + quote(root) + "; exit $LASTEXITCODE");
    assert.equal(result.status, 20, result.stderr);
    assert.match(result.stderr, /agent already exists.*connectivity is not verified/);
    assert.doesNotThrow(() => process.kill(agent!.pid!, 0));
  } finally {
    if (agent && agent.exitCode === null) {
      const exited = once(agent, "exit"); agent.kill(); await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
