# Zero-Cost Executor Quickstart Design

Date: 2026-10-01
Status: Approved for implementation
Branch: `build/executor-v1`
Constraint: recurring monetary cost must remain $0

## Goal

Make the existing Executor control plane immediately usable for real remote-laptop testing without requiring a purchased domain, paid hosting plan, Cloudflare account, or inbound firewall port.

The quickstart is a development/test deployment path. It does not replace a future stable production hostname.

## External service choice

Use Cloudflare Quick Tunnels only for the workstation-device ingress surface.

Current Cloudflare documentation states that Quick Tunnels:

- require no Cloudflare account;
- require no domain;
- create a temporary `*.trycloudflare.com` HTTPS hostname;
- support WebSocket upgrades through Cloudflare Tunnel;
- allow up to 200 in-flight requests;
- are intended for testing/development and have no uptime SLA;
- change hostname whenever the Quick Tunnel process restarts.

The zero-cost path SHALL NOT create a Cloudflare account resource, named tunnel, paid subscription, custom domain, usage-billed Worker, VM, or other metered infrastructure.

## Topology

```text
ChatGPT
   |
   | OpenAI Secure MCP Tunnel
   v
127.0.0.1:8787 /mcp
Executor control plane
   |
   +--> 127.0.0.1:8788 /device
             |
             | cloudflared Quick Tunnel
             v
 https://random.trycloudflare.com
             |
             | WSS outbound device attachment
             v
      Windows laptop / Synology node
```

The OpenAI Secure MCP Tunnel and the Cloudflare Quick Tunnel have different responsibilities. The OpenAI tunnel carries ChatGPT MCP traffic. The Cloudflare Quick Tunnel publishes only Executor's device-ingress listener.

## Operator experience

Primary command:

```powershell
.\scripts\Start-ExecutorZeroCost.ps1 -OpenAITunnelCredentialsFile "C:\path\to\executor keys.txt"
```

Optional:

```powershell
.\scripts\Start-ExecutorZeroCost.ps1 `
  -OpenAITunnelCredentialsFile "C:\path\to\executor keys.txt" `
  -DeviceId "test-laptop"
```

The quickstart SHALL:

1. build Executor if `dist/server.js` is missing;
2. read OpenAI tunnel identity/API secret from explicit environment variables or the operator-supplied credential file;
3. generate an ephemeral Executor client bearer if none is supplied;
4. start the existing headless Executor control plane;
5. locate `cloudflared` on PATH or install a local copy under `%LOCALAPPDATA%\Executor\tools`;
6. when downloading `cloudflared.exe`, use Cloudflare's official GitHub release URL and require a valid Windows Authenticode signature whose signer identifies Cloudflare;
7. launch `cloudflared tunnel --url http://127.0.0.1:8788`;
8. parse the assigned HTTPS `*.trycloudflare.com` URL from process logs;
9. probe `<public-url>/health` and require `role=device-ingress`;
10. persist only non-secret state including PIDs, local ports, public device URL, source head, and timestamps;
11. optionally generate a per-device enrollment command for `-DeviceId`;
12. clearly report that the hostname is temporary and will change after a tunnel restart.

The script SHALL fail closed rather than selecting a paid or account-requiring fallback.

## Credential-file input

A credential file is an operator convenience only. V1 accepts simple line-oriented text containing labels equivalent to:

```text
API secret key:
<secret>

tunnel_id:
<id>
```

The parser SHALL tolerate blank lines and case differences around labels. It SHALL never echo the secret value or write it to runtime state.

Explicit `EXECUTOR_TUNNEL_ID` / `EXECUTOR_TUNNEL_API_SECRET` environment variables override file values.

## Quick Tunnel lifecycle

New scripts:

- `Start-ExecutorZeroCost.ps1`
- `Get-ExecutorZeroCostStatus.ps1`
- `Stop-ExecutorZeroCost.ps1`
- `Restart-ExecutorZeroCost.ps1`

The stop/status path SHALL fence recorded PIDs against their current command lines before termination/healthy reporting, consistent with the existing Executor runtime scripts.

A restart creates a new Quick Tunnel and therefore normally a new public device URL. The restart command SHALL surface the new URL rather than implying endpoint stability.

## Laptop endpoint repointing

Add:

```powershell
.\scripts\Set-ExecutorInstalledDeviceEndpoint.ps1 -ServiceUrl "https://new.trycloudflare.com"
```

This changes only the non-secret `service_url` in the installed laptop's `device.json`, validates HTTPS except for loopback testing, and restarts the existing `Executor Device` scheduled task.

It does not alter the per-device token, reinstall Desktop Commander, or regenerate identity.

## Enrollment source pinning

`New-ExecutorDeviceEnrollment.ps1` SHALL prefer the exact local Git HEAD as the installer `SourceRef` when run from a Git checkout and no source ref is explicitly supplied.

This makes the generated bootstrap immutable to the tested Executor commit while retaining an explicit `-SourceRef` override for development.

## Synology branch compatibility

No Synology implementation is added on this branch.

The approved `design/synology-node-v1` branch remains a parallel lane. Its future node uses the same public device-ingress URL and `/device` protocol, so the zero-cost quickstart is transport-compatible without knowing Synology-specific tools or metadata.

## Security boundary

Quick Tunnel's public hostname is not authorization. Executor device authentication remains the per-device credential checked by the control plane.

The public device health route intentionally reveals only minimal aggregate device-ingress readiness. It does not expose MCP, workstation credentials, tunnel credentials, or device inventory.

The generated laptop bootstrap command contains that laptop's per-device credential and remains secret-bearing until a later one-time enrollment protocol replaces it.

## Failure behavior

Startup fails if:

- OpenAI tunnel credentials cannot be resolved;
- the headless control plane cannot become healthy;
- `cloudflared` cannot be obtained;
- the downloaded binary fails Authenticode validation;
- no Quick Tunnel URL appears before timeout;
- the returned URL is not HTTPS under `trycloudflare.com`;
- public device health cannot be verified.

No paid fallback is attempted.

## Testing

Repository tests SHALL cover:

- Quick Tunnel URL extraction and rejection of non-HTTPS/non-TryCloudflare URLs;
- static script contract proving no named-tunnel/account/domain/billing path is invoked;
- credential-file secret redaction/non-persistence contract;
- quickstart/stop/status/restart script presence and PID fencing;
- endpoint-repoint validation and task restart behavior;
- exact-source-ref preference in enrollment;
- all PowerShell parse on Windows;
- full existing Ubuntu/Windows CI and real Desktop Commander 8/64 qualification remain green.

Live creation of an actual Quick Tunnel is separate runtime evidence and is not claimed by ordinary CI.
