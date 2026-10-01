# Executor setup

Executor provides a self-hosted remote MCP path to full Desktop Commander workstation payloads. The control plane and workstation devices are independent: ChatGPT reaches the private MCP listener through Secure MCP Tunnel, while laptops connect outbound to a separate authenticated device-ingress listener.

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

## Start the headless control plane

Set `EXECUTOR_CLIENT_TOKEN`, `EXECUTOR_TUNNEL_ID`, and `EXECUTOR_TUNNEL_API_SECRET`, then build Executor and run:

```powershell
.\scripts\Start-ExecutorControlPlane.ps1
```

This starts only the Executor server and `tunnel-client`; it does **not** require `EXECUTOR_DEVICE_ID`, a Desktop Commander install, or any workstation to be online. The default profile remains 8 execution lanes per device and 64 logic lanes.

The MCP listener defaults to `127.0.0.1:8787`. The separate device-ingress listener defaults to `127.0.0.1:8788`. Put only the device listener behind your HTTPS/WSS reverse proxy. Do not publish the private MCP listener just to enroll laptops.

For device authorization, use one of:
- `EXECUTOR_DEVICE_TOKENS_FILE` — recommended for RDC-like live enrollment; re-read on every new device hello.
- `EXECUTOR_DEVICE_TOKENS_JSON` — static per-device map supplied at process start.
- `EXECUTOR_DEVICE_TOKEN` — optional shared fallback for an intentionally shared trust domain.

If none is supplied to `Start-ExecutorControlPlane.ps1`, it creates `%LOCALAPPDATA%\Executor\device-tokens.json` containing an empty object and points Executor at that file, so the control plane can come online with zero devices.

## Enroll any Windows laptop

On the control-plane host, generate a credential and bootstrap command:

```powershell
.\scripts\New-ExecutorDeviceEnrollment.ps1 `
  -DeviceId "shop-laptop" `
  -DeviceServiceUrl "https://devices.example.com"
```

The credential file is updated atomically and the running server will accept the new mapping without restart. The returned bootstrap command contains that laptop's device credential; treat the command as a secret until it has been used on the intended machine.

Run the printed command in PowerShell on the laptop. The current Windows bootstrap requires `git`, `node`, and `npm` on PATH. It:
1. fetches and builds Executor;
2. builds the exact pinned Desktop Commander payload;
3. stores only non-secret device configuration in `%LOCALAPPDATA%\Executor\device.json`;
4. protects the device token with Windows DPAPI in `device-token.dpapi`;
5. registers a current-user `Executor Device` logon task; and
6. starts the device agent immediately.

The laptop does not need the OpenAI tunnel ID, runtime API secret, or Executor client bearer. It needs only the TLS device-ingress URL, its device ID, and its own device credential.

Connected devices are visible from the ChatGPT Executor MCP surface through `list_devices`. Executor remains connectable and exposes `list_devices` when all workstation agents are offline.

For same-machine development, `scripts/Start-ExecutorDevice.ps1` remains available as a direct launcher.

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


## Zero-cost remote-laptop quickstart

The development/test quickstart keeps recurring infrastructure cost at $0 by using Cloudflare Quick Tunnels only for the separate Executor device-ingress listener.

```powershell
.\scripts\Start-ExecutorZeroCost.ps1 `
  -OpenAITunnelCredentialsFile "C:\path\to\executor keys.txt"
```

To generate enrollment for a laptop in the same command:

```powershell
.\scripts\Start-ExecutorZeroCost.ps1 `
  -OpenAITunnelCredentialsFile "C:\path\to\executor keys.txt" `
  -DeviceId "shop-laptop"
```

The credential file is read at runtime and the OpenAI API secret is not written to Executor runtime state. If `EXECUTOR_CLIENT_TOKEN` is absent, the wrapper generates an ephemeral one for the control-plane/tunnel-client process pair.

The wrapper downloads `cloudflared.exe` only from Cloudflare's official GitHub release path when no signed copy is available, then requires a valid Windows Authenticode signature identifying Cloudflare before execution.

Lifecycle commands:

```powershell
.\scripts\Get-ExecutorZeroCostStatus.ps1
.\scripts\Restart-ExecutorZeroCost.ps1 -OpenAITunnelCredentialsFile "C:\path\to\executor keys.txt"
.\scripts\Stop-ExecutorZeroCost.ps1
```

A Quick Tunnel restart normally changes the public `trycloudflare.com` hostname. Repoint an already-installed Windows node with:

```powershell
.\scripts\Set-ExecutorInstalledDeviceEndpoint.ps1 -ServiceUrl "https://new-host.trycloudflare.com"
```

That command changes only the non-secret service URL and restarts the existing `Executor Device` scheduled task. It does not replace the device ID, device credential, agent, or Desktop Commander payload.

This quickstart deliberately has no paid, domain-purchase, or metered-service fallback. A stable production hostname is a separate deployment choice.
