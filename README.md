# Executor

<img src="assets/executor-icon.png" alt="Executor hooded executioner icon" width="180">

**Self-hosted workstation execution for authorized AI clients, through the Model Context Protocol (MCP).**

Executor connects an MCP client to one or more enrolled computers. A headless control plane receives requests, selects an authenticated device connection, and forwards the pinned Desktop Commander tool surface to that device. The control plane can remain available even when no computers are connected.

Executor is deliberately a **full-authority** tool. With the operator's authorization, a client can execute arbitrary commands, inspect and control processes, use interactive sessions, and read, create, edit, search, or move files. It is **not** a sandbox, restricted command runner, or permission-reduction layer. Only connect clients and computers that belong in the same explicitly approved trust relationship.

## How it works

1. An authorized MCP client reaches the control plane's private `/mcp` listener. An OpenAI Secure MCP Tunnel can expose this listener to a ChatGPT client without publishing it as a general Internet endpoint.
2. The control plane tracks enrolled devices, connection generations, request admission, and execution outcomes.
3. Each device agent establishes an authenticated outbound connection to the separate HTTPS/WSS `/device` ingress. The control plane forwards MCP requests to its pinned Desktop Commander payload on that computer.

The private client listener and the device ingress are distinct security boundaries. A device agent does not need the OpenAI tunnel ID, tunnel API secret, or client bearer token; it uses its own enrollment credential and trusted device-ingress endpoint.

### Core capabilities

- **Full Desktop Commander semantics:** command execution, interactive sessions, process control, filesystem operations, and progressive search, without filtering the pinned payload's tools into a reduced API.
- **Explicit device routing:** authenticated enrollment, device selection, and connection-generation checks. The server stays responsive when all devices are offline.
- **Separate concurrency limits:** a configurable per-device execution-lane default of **8** and request/logic-lane default of **64**. Increasing these limits never grants additional authority.
- **Revocation:** a per-device token file can be re-read at attachment and dispatch time and during active connections. Removing a device-specific token is not sufficient for independent revocation if a shared fallback token remains configured.
- **Conservative failure handling:** ambiguous dispatched effects are recorded as `OUTCOME_UNKNOWN` and are not silently replayed.

## Quick start (Windows control plane)

Build and test from the repository root:

```powershell
npm ci --ignore-scripts
npm test
```

Configure `EXECUTOR_CLIENT_TOKEN`, `EXECUTOR_TUNNEL_ID`, and `EXECUTOR_TUNNEL_API_SECRET` in the operator's secure runtime environment, then start the headless control plane:

```powershell
.\scripts\Start-ExecutorControlPlane.ps1
.\scripts\Get-ExecutorControlPlaneStatus.ps1
```

The headless control plane does not require a locally enrolled workstation or Desktop Commander installation. For same-machine development or a manually provisioned workstation payload, use `scripts/Install-ExecutorDesktopCommander.ps1` as described in the setup guide.

The default MCP listener is loopback-only (`127.0.0.1:8787`); the distinct device listener defaults to `127.0.0.1:8788`. Use an authenticated HTTPS/WSS reverse proxy for remote device ingress. **Do not expose the private MCP listener as a shortcut for device enrollment.**

Enroll a Windows workstation from the control-plane host:

```powershell
.\scripts\New-ExecutorDeviceEnrollment.ps1 `
  -DeviceId "example-workstation" `
  -DeviceServiceUrl "https://devices.example.com"
```

The enrollment command updates the per-device credential mapping and prints a bootstrap command for that workstation. Treat the printed command as a secret. Run it only on the intended Windows computer, with `git`, `node`, and `npm` available. The agent protects its device token with Windows DPAPI and registers a current-user logon task.

For development on a single computer, `scripts/Start-ExecutorRuntime.ps1` remains available. For an operator-managed public device endpoint, `scripts/Start-ExecutorDirect.ps1` can configure Caddy TLS termination and a direct device route; it still requires a reachable TCP path, and CGNAT or a closed router port can prevent external attachment. No third-party relay is silently substituted for an unreachable direct device path.

**Full installation, tunnel, certificate, networking, and qualification instructions:** [docs/SETUP.md](docs/SETUP.md).

## Authorization and execution outcomes

Executor authorizes **whether** a client may operate a workstation; it does not narrow the workstation's commands after that grant. The device token store is checked on attachment and before downstream dispatch, with active-connection checks between requests. Invalid credential-store data fails closed. Revocation can stop future dispatches, but cannot undo a command already sent to a computer.

The effect ledger distinguishes:

| State | Meaning |
| --- | --- |
| `FAILED` | The effect was not dispatched, or is known not to have occurred. |
| `COMPLETED` | A result was observed for the dispatched request. For a process-start operation, a returned PID does not mean the process has exited. |
| `OUTCOME_UNKNOWN` | Delivery or execution may have happened, but the connection failed or timed out before the outcome could be established. |

Do not automatically retry a mutating request after `OUTCOME_UNKNOWN`. A command already dispatched may begin or finish after its caller disconnects. Executor's no-automatic-replay behavior is **not** a guarantee of exactly-once execution across manual retries or restarts.

## Components and documentation

- [Setup and live tunnel qualification](docs/SETUP.md) — build, enrollment, credentials, direct TLS, and runtime checks.
- [Keeper and recovery](docs/KEEPER_AND_RECOVERY.md) — optional Windows tray UI and recovery supervision for an existing installation.
- [Temporal event projection](docs/TEMPORAL_PROJECTION.md) — optional read-only export of saved execution events.
- [Source provenance](PROVENANCE.md) — pinned Desktop Commander and donor implementation references.

Executor draws on `thebrazenbeard/workbridgecommander`, `thebrazenbeard/workbridge`, and `thebrazenbeard/WorkBridgeMCP`. Their provenance does not imply that WorkBridge's bounded executable-grant mode is present in Executor.

## Verification and deployment boundary

Repository tests and CI cover source behavior, Windows and Ubuntu builds, the pinned Desktop Commander payload, and selected TLS/device-ingress scenarios. A passing check does **not** establish that any particular workstation is enrolled, that a private tunnel is currently reachable, or that a candidate repair is installed.

Keep device credentials, tunnel identifiers and secrets, DPAPI blobs, private certificates, and runtime state out of Git. Verify installed artifact identity, host authorization, routing, recovery state, and rollback before production changes. Treat installation, credential rotation, tunnel cutover, and deployment as separate operator-approved actions.
