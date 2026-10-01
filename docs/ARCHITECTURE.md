# Executor architecture

Executor is a full-authority remote workstation MCP bridge.

```text
AI client
  -> operator-owned secure MCP tunnel
  -> Executor remote ingress
  -> authenticated device attachment
  -> pinned Desktop Commander payload
  -> workstation
```

Executor has no bounded mode. Authorization answers whether a controller may operate a workstation. Once authorized, Executor does not replace full command/process semantics with executable grants, argument allowlists, or reduced environments.

## Parallel lane model

Executor separates two independent concurrency domains:

- **8 parallel execution lanes per connected device** by default.
- **64 parallel logic lanes** by default.

Logic lanes are independently admitted upstream work contexts. Execution lanes are effects actually dispatched to a workstation. Increasing concurrency does not create additional workstation authority.

## Remote Desktop Commander relationship

Executor targets the useful RDC experience: remote full filesystem and terminal access, interactive sessions, multiple connected devices, device selection, and remote MCP connectivity.

The infrastructure difference is that Executor does not route through RDC's hosted relay. It uses the operator's own tunnel and API secret.

That removes RDC's hosted service from the request path. It does not imply unlimited throughput: the AI client, tunnel/control plane, network, host, and configured Executor capacities can still impose limits.

## Currentness and mutation safety

Each connected device has a generation number. Replacing or reconnecting a device increments the generation. Effects admitted against stale generations are rejected before dispatch.

After dispatch, timeout or disconnect is classified `OUTCOME_UNKNOWN` unless a result was observed. Executor never silently replays ambiguous mutations.
