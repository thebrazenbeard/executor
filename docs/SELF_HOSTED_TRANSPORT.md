# Self-hosted transport

Preferred path:

```text
ChatGPT / MCP client
  -> Secure MCP Tunnel
  -> tunnel-client
  -> http://127.0.0.1:8787/mcp
  -> Executor
  -> connected workstation
```

Tunnel identity, API credentials, and Executor bearer credentials are runtime state and must not be committed to Git.

The tunnel profile should allow 64 concurrent upstream requests so transport configuration does not undercut Executor's 64 parallel logic-lane baseline.

Executor removes Remote Desktop Commander's hosted service from the execution path. It does not claim that the AI client, tunnel/control plane, network, or workstation have no limits.
