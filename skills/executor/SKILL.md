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
