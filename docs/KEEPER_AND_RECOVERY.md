# Executor

Executor is the delegated execution bridge between a coordinator and enrolled computers. This repository currently preserves **two separately developed Windows support components** for an existing Executor installation: gateway auto-recovery and the optional Keeper tray application. It is **not** a complete standalone Executor agent or control-plane distribution.

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Gateway recovery | `scripts/lappy-recovery/` | Supervise an already-installed Executor control plane; use the existing device identity, operator-sealed DPAPI tunnel credentials, local ports 19887/19888/9443, and a per-user five-minute scheduled task. |
| Keeper tray | `src/ExecutorKeeper/` | Display local health, read existing Windows tasks and recovery status, and—with an explicit user confirmation—request a run of the existing recovery task. |
| Keeper installer | `scripts/Install-ExecutorKeeper.ps1` | Side-by-side per-user Windows logon installation for the built tray package; it does not replace Executor. |
| Keeper tests | `tests/ExecutorKeeper.SmokeTests/` | Offline state-classification regressions; not cloud-to-device qualification. |

Recovery installation/operational evidence and limitations: [Lappy recovery notes](docs/LAPPY_EXECUTOR_RECOVERY_20261013.md). Original developments: [recovery PR #10](https://github.com/thebrazenbeard/executor/pull/10), [Keeper PR #11](https://github.com/thebrazenbeard/executor/pull/11).

## Build and test Keeper (Windows, .NET 10)

```powershell
dotnet run --project tests/ExecutorKeeper.SmokeTests/ExecutorKeeper.SmokeTests.csproj -c Release
dotnet build src/ExecutorKeeper/ExecutorKeeper.csproj -c Release -warnaserror
dotnet publish src/ExecutorKeeper/ExecutorKeeper.csproj -c Release --self-contained false -p:PublishSingleFile=false -o artifacts/win-x64
```

The Windows Desktop **.NET 10 runtime is required**. Publishing is framework-dependent and retains the accompanying DLL and runtime configuration files. `.github/workflows/executor-keeper.yml` runs the smoke tests, Windows build, publishing, and installer parse check. It does not exercise a real Windows login or cloud path.

## Inspect without installing

```powershell
# On a Windows machine with an existing Executor installation:
powershell.exe -NoProfile -File .\scripts\lappy-recovery\Register-ExecutorRecovery.ps1

# After publishing Keeper, view its install plan (no writes):
powershell.exe -NoProfile -File .\scripts\Install-ExecutorKeeper.ps1 -PublishDir .\artifacts\win-x64 -VersionId 20261016-abcdef0
```

**Do not apply either installer merely because the source was cloned.** Recovery depends on an installed Executor control plane, its preexisting launch scripts, device enrollment, a valid tunnel identity, and credentials sealed locally by the operator. The recovery task is installed only using the explicit `-Apply` switch; Keeper installation likewise requires `-Apply`. Each installer refuses selected collisions instead of overwriting preexisting tasks. Neither is a general-purpose provisioning mechanism.

## Health, scope, and security

- Keeper's `LOCAL_READY` is based on local health.json freshness, listening loopback ports, and preexisting Windows tasks; `CloudVerified=false` remains deliberate. Confirm the remote route independently with an authenticated Executor device-list and benign command probe.
- Local ports being open does **not** establish end-to-end reachability. Neither tray presence nor a successful scheduler result guarantees recovery after reboot, logout, sleep, provider outage, network disconnection, or credential expiry.
- Do not commit DPAPI credential containers, device identity, `device.json`, `direct-state.json`, tunnel secrets, Caddy PKI, locally collected private logs, or runtime audit material.
- The existing gateway recovery scheduler is the automatic repair authority. Keeper must not become a competing watchdog or silently restart services.
- The PowerShell scripts were qualified in a particular Lappy environment. Installation, machine-wide activation, trust changes, and production deployments require separate authorization and verification.

## Integration status

This integration combines source from the two independently developed draft PRs without modifying the installed Executor configuration. Keeper CI **passed on its original PR #11 head** on 2026-10-15; this integration commit needs its own Windows CI result and review before any stronger qualification claim. Recovery's historical installation checks are described in the recovery notes, not treated as tests of this combined branch.

The initial `main` contained a bootstrap marker, editor settings and font assets only. The original font assets remain unchanged here; their presence does not imply an actively built web interface.
