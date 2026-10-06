# Executor

**Remote full-authority workstation execution for AI clients over MCP.**

Executor is a remote execution bridge between an authorized AI controller and a workstation. It is derived from the WorkBridge Commander implementation, but the product boundary is intentionally simpler: **there is no bounded mode**.

Once a workstation is explicitly authorized and connected, Executor preserves the full workstation tool semantics of its pinned Desktop Commander payload: arbitrary command strings, interactive process sessions, process inspection and control, filesystem operations, progressive search, local tool history, and configuration/document tools exposed by the pinned payload.

## Authority model

```text
Principal / operator
       |
       | grants workstation authority
       v
AI controller
       |
       | MCP requests
       v
Executor control plane
       |
       +--> private /mcp listener <-- OpenAI Secure MCP Tunnel
       |
       +--> TLS-fronted /device listener
                    |
                    | authenticated outbound attachment
                    v
             Executor device agent
       |
       | exact MCP forwarding
       v
Pinned Desktop Commander payload
       |
       v
Workstation
```

Executor is an **effect boundary**, not a permission-reduction layer. Authentication, explicit device selection, connection-generation fencing, provenance verification, scheduling, and outcome tracking protect the route. They do not silently narrow the workstation command surface after authority has been granted.

## Full-authority-only invariant

Executor has one execution model:

- arbitrary command strings remain available through `start_process(command=...)`;
- interactive process sessions remain available;
- OS process inspection/control remain available;
- filesystem read/write/edit/search semantics remain available;
- transport components must not rename, filter, narrow, or reinterpret payload tools;
- there is no named-executable grant mode;
- there is no deny-by-default argument gate;
- there is no reduced-environment substitute for the full payload;
- there is no automatic failover or replay of mutations after ambiguous transport failure.

The authorization decision is whether Executor may operate the workstation at all. Once that authority exists, Executor does not pretend to grant "full control" while quietly substituting a constrained process API.

## Concurrency model

Executor keeps parallel logic-lane concurrency separate from workstation-effect concurrency.

- **Parallel execution lanes:** configurable per-device concurrency for workstation effects. The inherited baseline/default is 8.
- **Parallel logic lanes:** configurable concurrent request/admission contexts. The inherited baseline/default is 64.
- **No authority multiplication:** increasing concurrency does not create additional permissions.
- **Resource serialization:** operations that target the same protected resource may be serialized without changing their semantic authority.

## Failure semantics

Executor distinguishes three important states:

- **FAILED** — the effect was not dispatched or is known not to have occurred.
- **COMPLETED** — a result was observed for the dispatched effect.
- **OUTCOME_UNKNOWN** — the effect may have occurred, but the connection failed or timed out after dispatch.

`OUTCOME_UNKNOWN` effects are never silently replayed. Reconciliation must establish current state first.

## Repository lineage

Executor starts from:

- `thebrazenbeard/workbridgecommander` — remote MCP ingress, device attachment, lane orchestration, effect ledger, and Commander plugin surface.
- `thebrazenbeard/workbridge` — donor research for hardened path/currentness/concurrency and relay operational lessons. Its bounded executable-grant runtime is **not** part of Executor.
- `thebrazenbeard/WorkBridgeMCP` — donor research for exact Desktop Commander source pinning, qualification, process/session parity, and the rule that transport must not semantically narrow the workstation payload.

Exact donor heads are recorded in [PROVENANCE.md](PROVENANCE.md).

## Operator runtime

The primary runtime is now the **headless control plane**. It starts Executor plus the OpenAI Secure MCP Tunnel and remains online with zero workstations connected:

```powershell
.\scripts\Start-ExecutorControlPlane.ps1
.\scripts\Get-ExecutorControlPlaneStatus.ps1
.\scripts\Restart-ExecutorControlPlane.ps1
.\scripts\Stop-ExecutorControlPlane.ps1
```

The MCP listener stays private/loopback-first for `tunnel-client`. Remote laptops use a separate device-ingress listener, normally placed behind HTTPS/WSS termination. Secure MCP Tunnel is intentionally not treated as a generic device relay.

To authorize a Windows laptop, generate a per-device credential on the control-plane host:

```powershell
.\scripts\New-ExecutorDeviceEnrollment.ps1 -DeviceId "shop-laptop" -DeviceServiceUrl "https://devices.example.com"
```

The script updates the live credential file and prints a bootstrap PowerShell command. Run that command on the target laptop. The laptop receives only its device credential and device-ingress URL—never the tunnel ID or tunnel API secret. The installer builds the Executor agent and exact pinned Desktop Commander payload, protects the device token with Windows DPAPI, registers a current-user logon task, and attaches outbound.

The older `Start-ExecutorRuntime.ps1` all-in-one server+local-device+tunnel launcher remains as a convenience for single-machine development and qualification.

## Status

The V1 branch is qualified on Ubuntu and Windows. Windows qualification builds the exact pinned Desktop Commander payload and observed 8 active execution lanes and 64 active logic lanes while processing 64 concurrent calls.

See [docs/SETUP.md](docs/SETUP.md) for the self-hosted tunnel and workstation setup.

Repository qualification does not prove that a particular private tunnel or workstation is currently online. Runtime activation remains separate evidence.


## Executor Desktop

Executor now includes a Windows desktop companion under `desktop/`. The companion is an operator console for the existing local Executor runtime; it is not a second workstation agent and it does not replace the ChatGPT plugin.

It shows the local control-plane state, ChatGPT activation state, connected workstation count, and the configured 8 execution / 64 logic lane profile. The **Repair MCP session** action invokes only `Restart-ExecutorControlPlane.ps1`, then refreshes status. That narrow recovery path:

- reuses the existing direct-runtime tunnel profile and credential-file binding;
- generates a fresh ephemeral MCP bearer token for the restarted session;
- reuses the installed device credential store and device identity;
- does not create a new OpenAI tunnel or API key;
- does not stop/recreate Caddy, Windows Firewall rules, UPnP, or NAT-PMP mappings.

Build it on Windows with Wails v2.14.0:

```powershell
cd desktop
go test ./...
go install github.com/wailsapp/wails/v2/cmd/wails@v2.14.0
& (Join-Path (go env GOPATH) "bin\wails.exe") build -clean -platform windows/amd64 -trimpath -webview2 browser
```

CI publishes `executor-desktop-windows-amd64.exe` as a workflow artifact. Building the companion does not install or activate it.

## Zero-cost, no-relay device ingress

Executor's primary remote-device path is direct TLS. There is no Cloudflare/Tailscale/ngrok/VPS relay in the device traffic path and therefore no third-party per-request, in-flight-request, or relay-bandwidth quota.

On the control-plane Windows machine:

```powershell
.\scripts\Start-ExecutorDirect.ps1 `
  -OpenAITunnelCredentialsFile "C:\path\to\executor keys.txt" `
  -DeviceId "test-laptop"
```

The command:

- starts the zero-device-capable Executor control plane and OpenAI Secure MCP Tunnel;
- automatically downloads the current official OpenAI `tunnel-client` Windows release when it is not already available, verifies the archive against OpenAI's published `SHA256SUMS.txt`, and caches the verified binary locally;
- resolves the public IPv4 address unless `-PublicHost` is supplied;
- downloads Caddy from its official GitHub release only when needed and verifies the release archive against the official SHA-512 checksum file;
- keeps Caddy's CA under Executor's persistent runtime directory and does not install that CA into the host-wide trust store;
- terminates direct TLS on TCP 9443 by default and proxies only `/device` and `/health` to the loopback device listener;
- attempts a Windows Firewall rule and UPnP TCP mapping;
- emits an exact-commit-pinned enrollment command containing the public CA certificate and that device's credential.

The enrolled device trusts only the supplied Executor/Caddy CA for this connection; the CA private key never leaves the control-plane host.

Runtime controls:

```powershell
.\scripts\Get-ExecutorDirectStatus.ps1
.\scripts\Restart-ExecutorDirect.ps1
.\scripts\Stop-ExecutorDirect.ps1
```

An already-installed laptop can be pointed at a changed public address without changing its identity, DPAPI-protected credential, or CA:

```powershell
.\scripts\Set-ExecutorInstalledDeviceEndpoint.ps1 -ServiceUrl "https://203.0.113.10:9443"
```

### Network boundary

Direct ingress requires an actually reachable public IPv4/TCP path. If UPnP is unavailable, forward the chosen TCP port on the router to the Executor host. If the ISP places the site behind CGNAT and provides no directly reachable address, Executor cannot make inbound direct connectivity appear without introducing a relay; under the no-rate-limited-relay requirement it reports that as a deployment blocker instead of silently falling back.

Repository CI now exercises a real Caddy internal-CA TLS boundary and WSS device hello on Windows in addition to the exact pinned Desktop Commander 8/64 qualification. A particular home/work router and ISP path remain separate runtime evidence.
