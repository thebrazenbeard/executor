# Lappy Executor recovery — installed and restart-tested (2026-10-13/14)

**Status:** locally installed on authorized workstation Lappy; source copied into this isolated Draft branch for reproducibility. **Not merged into `main`.** The installed process is the existing Executor service and device identity, *not* `vera_core.QualifiedVeraRuntime`.

## Observed failure and actual repair

The original Executor task could keep an agent process running while its service URL `https://127.0.0.1:9443` refused connections. The installed control-plane startup attempted to bind `127.0.0.1:18887` and failed with Windows `EACCES`. A direct same-user socket bind test confirmed `18887` and `18888` were denied by Windows, whereas `19887`, `19888` and `9443` could bind.

The fix does **not** alter Windows excluded-port ranges or install a different network driver. The local recovery launcher starts the installed Executor direct/control-plane stack on `19887` (MCP), `19888` (device ingress), and `9443` (existing HTTPS endpoint). The original local certificate and inbound rule are retained. It uses manual port mapping and did not create any firewall, UPnP or NAT-PMP mapping.

The original tunnel ID and API secret were provided **interactively on Lappy**, not in chat or GitHub, and sealed with Windows DPAPI for the current user. The local device's existing DPAPI token and device identity were preserved. Never commit the sealed credential file, `device.json`, `direct-state.json`, Caddy PKI, logs, screenshot material or local personal audit records.

## Installed components

At `%LOCALAPPDATA%\Executor\Recovery\` on Lappy:

- `Invoke-ExecutorRecovery.ps1` — idempotent guarded health/restart; single named mutex, same-user DPAPI unseal, exact local ports, state readback, 15-minute **failed-attempt** backoff, no duplicate launch. Its JSON status is `health.json`. `chatgpt_connector_verified=false` in that local status is **intentional**; only a remote MCP call can establish the actual ChatGPT route.
- `Set-ExecutorRecoveryCredentials.ps1` — one-time interactive DPAPI setup, refuses overwrite. Do **not** invoke unattended.
- `Register-ExecutorRecovery.ps1` — requires explicit `-Apply`, installs one per-user scheduled task `Vera-Executor-ControlPlane-Recovery`, logon and five-minute repeat, `Limited` run level, `IgnoreNew` concurrent execution. The task reports nonzero exit code on missing credentials or failure.

The launcher is anchored to the preinstalled Executor `Agent\scripts\Start-ExecutorDirect.ps1`, `Get-ExecutorDirectStatus.ps1`, its tunnel-client executable and Caddy. **It is not a standalone replacement for the Executor runtime.** A new machine still requires an authorized Executor installation, device enrollment, trust and tunnel credentials through their existing security processes.

## Verification results

1. All three installed PowerShell scripts parsed successfully with `System.Management.Automation.Language.Parser`.
2. Before credential sealing, a task run returned `WAITING_CREDENTIALS` with nonzero Task Scheduler result; the previous false-positive 'healthy agent' behavior did not reoccur.
3. After the operator sealed credentials, scheduled recovery returned `LOCAL_READY`; `9443/19887/19888` listeners were present. `Get-ExecutorControlPlaneStatus` reported server/tunnel identity matches, `mcp_health_ok=true`, `device_ingress_health_ok=true`, `mcp_session_verified=true`, and `connectedDeviceCount=1`.
4. The **ChatGPT Executor plugin** itself listed `Lappy` as connected (execution capacity 8), and `start_process` executed a harmless PowerShell command on Lappy with readback.
5. Controlled resilience test: only after direct state showed no firewall/UPnP/NAT-PMP mapping created, the installed `Stop-ExecutorDirect.ps1` stopped gateway/control plane. The local recovery task was triggered via Remote Desktop Commander, recreated the listeners and control-plane session, cleared its retry timer, and returned Task Scheduler result 0. The Executor ChatGPT plugin then re-listed Lappy and executed a second independent PowerShell command through the restored route. Verification time approximately 2026-10-14 00:20 UTC.
6. Meaningful local audit events were appended to `D:\VERA\blotter-runtime\data\activity.sqlite3` through event 237.

**Not tested:** full Windows reboot/logoff and unattended five-minute trigger without an explicit test kickoff; prolonged disconnection; different Windows user or a different machine; provider-side outage; tunnel credential expiry/rotation. The installed task's recurrence was read back but a reboot-survival claim would be premature.

The existing `Get-ExecutorChatGPTActivationStatus.ps1` may still say `tunnel id unavailable` in a bare PowerShell session because it checks environment/legacy state paths, not this local DPAPI container. It should not override the stronger end-to-end evidence: actual Executor MCP `list_devices` and `start_process` succeeded. A later independent status-script refinement could reconcile this without exposing secrets.

## Hostile review

> **Objection:** "Permanent" is an unsupported claim after one gateway restart and one reconnect. The service can still fail if DPAPI cannot decrypt after account migration, credentials expire, Windows reserves these fallback ports, or ChatGPT's connector is disconnected.

**ACCEPTED.** The fix is *persistently installed and restart-tested*, not guaranteed permanent. It preserves operator-visible failure states and avoids automatic privilege, permission or credential changes. Fresh after-boot and longer unattended observations remain required for a stronger operational readiness claim.

> **Objection:** Running a second watchdog can race the existing device-agent keepalive.

**PARTIALLY ACCEPTED.** This new task supervises only the **gateway/control plane** with a single mutex, bounded restart backoff, and no new device-agent task or device enrollment. The existing device task remains responsible for the agent. The exact components must not be conflated.

## 2026-10-18 Lappy recovery cadence repair (installed, not cold-boot qualified)

The live `Vera-Executor-ControlPlane-Recovery` Task Scheduler principal remains
`patri` / `Interactive` / `Limited`, preserves `IgnoreNew`, and retains
its existing logon trigger and PowerShell action. Its single recurring time
trigger was changed in place from `PT5M` to `PT1M` and read back.
The `Executor Device` task separately retains the prior validated password
logon and 3 x `PT1M` process restart settings; neither identity was changed.

The installed `%LOCALAPPDATA%\Executor\Recovery\Invoke-ExecutorRecovery.ps1`
uses stable consecutive local-readiness checks, gates failed attempts for 90
seconds instead of 15 minutes, and clears a stale cooldown only when already
locally healthy. It retains the original single mutex, existing DPAPI tunnel
credentials, exact 19887/19888/9443 ports and `Manual` mapping. Atomic
replacement verified installed script SHA-256
`1A2415E1B21761CE5DB3A7BF8E7CC0638AA97A64D4E0E825ECBFDE6D3400FF25`.
Original PowerShell script and Task Scheduler XML were separately backed up
locally under `Recovery\backups\startup-hardening-20261018-145921`.

**Executed evidence:** PowerShell parse PASS; isolated fake `LOCALAPPDATA` and
distinct mutex with NO real credentials or gateway startup verified 4 PASS /
0 FAIL (20, 60, 120, 180 seconds after a synthetic failed start).
An actual healthy scheduled recovery execution returned Task Scheduler 0,
`LOCAL_READY`, with no 19887/19888/9443 listener PID replacement. Subsequently
the 1-minute task fired unattended (15:05:24 local) with Task Scheduler 0
and `LOCAL_READY`. Direct ChatGPT Executor `list_devices` returned Lappy,
VERA-NODE-1, VN2 connected, and live Lappy commands succeeded.

**Claim limits:** An actual Windows reboot, logged-out/pre-login startup,
induced gateway-crash recovery and longer soak were NOT tested. `Interactive`
means the gateway recovery task depends on the user's logged-on context;
it must not be silently moved to SYSTEM (user-scoped DPAPI credentials would
no longer be available). Remote route health at time of verification does
not prove future unattended operation or permanent external connectivity.
The GitHub source change is a Draft for reproducibility; the installed
Lappy changes are the active repair, not a main merge or new service.
