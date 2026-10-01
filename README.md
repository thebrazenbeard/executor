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

## Synology Executor Node

Executor also supports a native `synology-storage` device profile for the Synology DS216. The DSM node is a storage endpoint rather than a Desktop Commander transplant: it is a static ARMv7 Go process packaged as `ExecutorNode-armada38x-0.1.0-0001.spk`.

Inside shared-folder roots granted to the package user, ChatGPT/Executor receives full file-content Read/Write authority, including create, replace, append, copy, move, delete, hash, and search operations. Descriptor-relative path handling rejects traversal and symlink escapes. The node may inspect supported DSM state broadly, but a DSM mutation follows `admin.prepare_change` -> exact proposal shown to the user -> explicit user approval -> `admin.apply_change` -> readback verification.

Concurrency is device-specific: **Windows workstation devices retain 8 parallel execution lanes; the DS216 `synology-storage` node advertises 2 parallel execution lanes; the Executor control plane retains 64 parallel logic lanes.**

The SPK runs as the DSM package user rather than root. Repository CI can build and validate the `armada38x` artifact, but that does not prove physical installation or operation on a particular DS216; physical-NAS qualification is recorded separately.

See [nodes/synology/README.md](nodes/synology/README.md) for installation and package details.

## Status

The V1 branch is qualified on Ubuntu and Windows. Windows qualification builds the exact pinned Desktop Commander payload and observed 8 active execution lanes and 64 active logic lanes while processing 64 concurrent calls.

See [docs/SETUP.md](docs/SETUP.md) for the self-hosted tunnel and workstation setup.

Repository qualification does not prove that a particular private tunnel or workstation is currently online. Runtime activation remains separate evidence.
