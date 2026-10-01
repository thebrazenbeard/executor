---
name: executor
description: Use Executor to operate an authorized workstation through the operator-controlled remote MCP path.
---

# Executor

Executor is full-authority workstation execution.

- Do not substitute a bounded process model.
- Preserve full Desktop Commander file, search, process, terminal, session, configuration, and document semantics.
- Treat **8 parallel execution lanes per device** and **64 parallel logic lanes** as the default concurrency profile.
- Preserve explicit workstation identity and connection generation for effects.
- Treat post-dispatch timeout or disconnect as outcome unknown until reconciled.
- Never silently replay an ambiguous mutation.
- Verify mutations by reading current state back when practical.
- Keep tunnel identity, API credentials, bearer tokens, and device credentials out of repository source.


## Synology DSM changes

For a `synology-storage` device, storage content operations inside granted roots are normal Executor storage operations. DSM setting or service mutations use the verified-change flow.

1. Call `admin.prepare_change` with the exact target and parameters.
2. Present the returned current state, proposed state, side effects, recovery information, expiration, and change ID to the user.
3. Obtain **explicit user approval for that exact proposal**.
4. Never call `admin.apply_change` without explicit user approval for the still-current change ID.
5. After apply, verify the observed state. For reconnect/restart, verify the new device generation and re-check representative tools after the node returns.

Do not reinterpret approval for one change ID as approval for another target, modified parameters, or a newly prepared replacement proposal.
