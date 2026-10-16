# Keeper scheduled-task health: process command-line visibility

Status: qualified source candidate and bounded live local repair, 2026-10-16.

## Fault

The existing limited Windows Task Scheduler recovery principal could see Node, tunnel client and Caddy process IDs and process names, but `Win32_Process.CommandLine` was null for those elevated processes. Previously `Get-ExecutorControlPlaneStatus.ps1` and `Get-ExecutorDirectStatus.ps1` treated command-line invisibility as negative identity, yielding `running:false`, even when the matching local status endpoints were healthy.

The recovery scheduler then entered 15-minute restart `BACKOFF`; the independent Keeper tray interpreted `health.json` status as `STATUS_STALE`. Repeating the same command-line check could not solve that Windows access-control boundary.

## Changes

Both scripts retain strict command-line matching whenever Windows exposes it.

Only when the command line is inaccessible, the control-plane checker requires exact process name and recorded PID ownership of **both** loopback MCP/device listeners, and of the tunnel client's own loopback `/readyz` listener. Independent HTTP endpoint health remains mandatory.

The direct checker accepts an inaccessible Caddy command line only when the recorded PID owns the configured local TLS listening port and process name is exactly `caddy.exe`. Its existing separate certificate/TLS reachability qualification stays mandatory. The NAT-PMP process check has no new fallback.

Both fallbacks reject PID mismatches, absent/foreign listeners, wrong names, visible command-line mismatch and failed socket enumeration. The listener ownership is local OS evidence, **not** a cryptographic executable attestation or remote ChatGPT route attestation. `CloudVerified` remains false in Keeper. No credentials, tunnel identity, token or process owner changed.

## Validation

- Unit fallback tests: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/Test-ControlStatusFallback.ps1` (eight scenarios) and `scripts/tests/Test-DirectSocketFallback.ps1` (eight scenarios), all passed.
- Full Executor `npm test` at the branch head after source changes: 78 passed, zero failures.
- Independent Windows scheduled-task token probes, same limited `LAPPY\\patri` principal and session as real five-minute recovery: unmodified checker returned false, despite all three local ports and endpoints healthy. Candidate control checker returned `running:true` with `LOOPBACK_SOCKET_OWNER`; candidate full direct checker returned `running:true` with `TLS_SOCKET_OWNER`.
- Qualified scripts installed atomically with same-volume original backups and exact SHA-256 readback. Existing scheduled recovery was briefly paused during repair, then re-enabled.
- The **real** scheduled recovery task was manually triggered after both installations: `LastTaskResult=0`, `health.json.status=LOCAL_READY`, Keeper binary `--status` returned `LOCAL_READY`, `CloudVerified=false`, without changing server or tunnel PID. Both connected devices remained online; the gateway remains 8 execution slots/device and 64 logic contexts.

No gateway stop/restart, production provider mutation, credential modification, or change to Executor capacity was part of this repair. Physical Keeper UI refresh is not independently attested.

## Repository lineage

This branch is based on the installed Executor source lineage and targets the existing device-health source branch. The repository's current `main` is an unrelated initialization lineage; do not merge histories or promote production based solely on passing local tests.
