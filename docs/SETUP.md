# Executor setup

Executor provides a self-hosted remote MCP path to a full Desktop Commander workstation payload.

## Build

```powershell
npm install --ignore-scripts
npm test
npm run build
```

## Install the workstation payload

```powershell
.\scripts\Install-ExecutorDesktopCommander.ps1
```

The installer builds the exact pinned Desktop Commander source and prints the SHA-256 of `executor-desktop-commander.manifest.json`. Keep that digest as the external trust anchor used by the device agent.

The installer intentionally does not apply the donor WorkBridge four-process overlay. Executor's qualified baseline is 8 parallel execution lanes and 64 parallel logic lanes.

## Start the service

Configure `EXECUTOR_CLIENT_TOKEN`, `EXECUTOR_EXECUTION_CAPACITY=8`, `EXECUTOR_LOGIC_CAPACITY=64`, and the allowed browser origin. For device ingress, configure either a shared `EXECUTOR_DEVICE_TOKEN`, `EXECUTOR_DEVICE_TOKENS_JSON` as a JSON object mapping device IDs to tokens, or both. A mapped device ID requires its mapped token and cannot fall back to the shared token. Start Executor with `npm start`.

For the private tunnel-first path, bind the service to loopback on port 8787.

## Attach a workstation

Run `scripts/Start-ExecutorDevice.ps1` with the Executor service URL, a device ID, the device token, the trusted manifest SHA-256, and the Desktop Commander install root.

Connected devices are visible through `list_devices`. Executor remains connectable and exposes `list_devices` even when all workstation agents are offline.

## Start the private tunnel

Provide your tunnel identity, runtime API credential, and Executor client token as runtime environment values, then run:

```powershell
.\scripts\Start-ExecutorTunnel.ps1
```

The checked-in profile allows 64 concurrent upstream requests. No live credential or tunnel identity belongs in Git history.

## One-command local runtime

After building Executor and installing the pinned Desktop Commander payload, the Windows operator surface can bring up the service, device agent, and private tunnel together.

Runtime environment must provide the client credential, workstation identity/install information, tunnel identity/API credential, and either a shared device credential or the per-device credential map described above. With map-only server credentials, the launcher can resolve the local agent token from the map for `EXECUTOR_DEVICE_ID`; `EXECUTOR_DEVICE_AGENT_TOKEN` can override that resolution without enabling a shared server credential.

```powershell
.\scripts\Start-ExecutorRuntime.ps1
.\scripts\Get-ExecutorStatus.ps1
.\scripts\Restart-ExecutorRuntime.ps1
.\scripts\Stop-ExecutorRuntime.ps1
```

The runtime defaults to 8 parallel execution lanes and 64 parallel logic lanes. It verifies local health, device attachment, tunnel MCP-session initialization, and the tunnel client's live `/readyz` readiness endpoint before writing state. `Get-ExecutorStatus.ps1` re-probes `/readyz`, so a still-running but no-longer-ready tunnel is reported as not running.

Runtime state is stored under `%LOCALAPPDATA%\Executor\runtime-state.json` by default. That file contains PIDs, device identity, lane counts, local MCP address, timestamps, and log location—never the tunnel API credential or Executor/device bearer credentials. Stop/restart re-check each recorded PID's Windows command line before termination so PID reuse cannot silently kill an unrelated process.

## Connect the AI client

Bind ChatGPT or another remote-MCP-capable client to the actual endpoint associated with your private tunnel.

Executor injects an optional `deviceId` argument into downstream workstation tool schemas. Executor consumes that routing field and removes it before dispatch, preserving the underlying Desktop Commander tool semantics.

## Qualify the live tunnel

Repository CI proves the Executor service and the pinned Desktop Commander payload at **8 parallel execution lanes** and **64 parallel logic lanes**, but that does not prove your actual tunnel/control-plane path can sustain the same overlap.

With the normal Executor runtime already running, provide the external **non-loopback HTTPS** MCP endpoint and target workstation:

```powershell
$env:EXECUTOR_REMOTE_MCP_URL = "https://your-live-remote-mcp-endpoint/mcp"
$env:EXECUTOR_REMOTE_DEVICE_ID = "your-device-id"
# Only if the remote endpoint itself requires an Authorization header:
$env:EXECUTOR_REMOTE_AUTHORIZATION = "Bearer <runtime-only-credential>"

npm run qualify:live-tunnel
```

The qualifier sends 64 concurrent `start_process` calls through `EXECUTOR_REMOTE_MCP_URL` and samples the authenticated local Executor `/health` counters using the already configured `EXECUTOR_CLIENT_TOKEN`. It passes only if the live path observes at least 8 simultaneous execution effects and 64 simultaneous logic lanes.

`EXECUTOR_REMOTE_AUTHORIZATION` is optional and is never written to repository state. Credentials embedded directly in the remote URL are rejected; use the authorization variable instead when the endpoint requires a header. Loopback and plaintext URLs are also rejected so local traffic cannot be mislabeled as live-tunnel evidence. The harness is deliberately excluded from ordinary GitHub Actions because CI does not possess your live tunnel identity or credentials.

## Evidence boundary

Repository CI proves source/build behavior and real-payload 8/64 concurrency on its qualification runner. It does not prove that a personal tunnel is currently active or that a specific workstation is currently connected.
