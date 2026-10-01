# Executor architecture

Executor is a full-authority remote workstation MCP bridge with an always-on control plane and replaceable workstation devices.

```text
ChatGPT / MCP client
        |
        | OpenAI Secure MCP Tunnel
        v
private Executor /mcp listener
        |
        v
Executor control plane
        |
        +---------------------------+
        | separate device ingress  |
        | HTTPS/WSS, /device only  |
        +------------+--------------+
                     |
           outbound authenticated
           device connections
              /              \
             v                v
       Laptop A           Laptop B
       Executor agent     Executor agent
       Desktop Commander  Desktop Commander
```

Secure MCP Tunnel is an outbound-only MCP path between OpenAI and the private MCP listener. It is not used as a generic workstation relay. Remote laptops attach to the independent device-ingress listener, which exposes the authenticated `/device` WebSocket and a minimal health endpoint but does not expose `/mcp`.

The control plane is valid with zero connected workstations. A workstation becomes usable only after its device agent attaches; losing every workstation does not make the ChatGPT-side Executor MCP endpoint disappear.

Executor has no bounded mode. Authorization answers whether a controller may operate a workstation. Once authorized, Executor does not replace full command/process semantics with executable grants, argument allowlists, or reduced environments.

## Device enrollment and credentials

Per-device credentials may be loaded from a JSON credential file. The file is re-read on every new device hello, so adding a laptop does not require a control-plane restart. Static `EXECUTOR_DEVICE_TOKENS_JSON` entries override file entries, and the existing shared token remains only an optional fallback for unmapped IDs.

The Windows enrollment helper generates a cryptographically random per-device token, writes it into the control-plane credential file, and emits a bootstrap command for the target laptop. The laptop stores that token with Windows DPAPI and never receives the OpenAI tunnel ID or tunnel runtime API key.

## Parallel lane model

Executor separates two independent concurrency domains:

- **8 parallel execution lanes per connected device** by default.
- **64 parallel logic lanes** by default.

Logic lanes are independently admitted upstream work contexts. Execution lanes are effects actually dispatched to a workstation. Increasing concurrency does not create additional workstation authority.

## Remote Desktop Commander relationship

Executor targets the useful RDC experience: one AI-side MCP connection, an always-on control plane, multiple independently connectable devices, explicit device selection, remote filesystem/terminal access, and a small PowerShell enrollment step on each Windows laptop.

The infrastructure differs from RDC's hosted relay. Executor uses the operator's own control-plane host, OpenAI Secure MCP Tunnel for ChatGPT-to-MCP transport, and a separately TLS-fronted device ingress for laptop-to-control-plane transport.

## Currentness and mutation safety

Each connected device has a generation number. Replacing or reconnecting a device increments the generation. Effects admitted against stale generations are rejected before dispatch.

After dispatch, timeout or disconnect is classified `OUTCOME_UNKNOWN` unless a result was observed. Executor never silently replays ambiguous mutations.
