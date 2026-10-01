# Security

Executor is a remote-control surface. Treat access to its MCP identity as access to the authority exposed by the connected workstation payload.

## Trust model

Executor preserves full Desktop Commander semantics, including arbitrary command-string execution. Payload integrity verifies what implementation is launched; it is not a sandbox and does not reduce workstation authority.

The remote layer therefore depends on strong authentication, explicit device association, encrypted transport, connection-generation fencing, and exact routing. `EXECUTOR_DEVICE_TOKENS_JSON` can bind distinct credentials to specific device IDs; when an ID is mapped, the shared device token cannot impersonate it.

## No false deployment claims

Repository source and CI do not prove that a tunnel is active, a workstation is connected, an AI client is authorized, or an external effect occurred.

## Secrets

Never commit tunnel credentials, API secrets, bearer tokens, device credentials, or private keys.

## Network boundary

The device agent rejects non-loopback plaintext service URLs. Remote operation requires TLS or explicit loopback development. Browser-origin requests are accepted only when their exact Origin is configured.

## Effect ambiguity

A disconnect or timeout after dispatch is treated as `OUTCOME_UNKNOWN` unless the result is reconciled. Executor does not silently replay ambiguous mutations.

## Full-authority invariant

Executor has no bounded mode. Security controls protect who may reach the workstation and which device receives an effect; they do not silently replace the workstation command surface with an allowlisted substitute.
