# Tattler reasoning-surface results — 2026-10-07

Status: OBSERVATION NOTE / NO EXECUTOR SEMANTIC CHANGE

## Shared experiment result

On 2026-10-07, the same repository stress-test prompt was run through three ChatGPT surfaces while WorkLaptop was instrumented with Tattler plus a companion Codex process/network tracer.

Observed controlled windows:

- Desktop Chat, GPT-5.6 Sol High: **0 MXC launches** and **2 new established Codex TLS connections** in the companion tracer.
- ChatGPT Desktop Work, Ultra: **59 MXC launches** and **73 new established Codex TLS connections** using the same companion-tracer definitions.
- Firefox cloud Work, Max: browser-side traffic was observable locally, but the provider's server-side worker topology was not.

The experiment supports a bounded conclusion: Desktop Work used materially different local orchestration from ordinary High Chat in this runtime. It does **not** establish that sockets or MXC processes equal agents, that connection fanout grants a reasoning tier, or that a client can promote High into Ultra/Max by imitating transport behavior.

Canonical detailed evidence is being preserved in `thebrazenbeard/tattler` PR #7 and the reasoning interpretation in `thebrazenbeard/rezon` PR #103.


## Why Executor needs this result

Executor was part of the observation/control path used to run commands and retrieve telemetry from WorkLaptop. That makes this result relevant to Executor's interpretation boundary.

Executor execution capacity, active/queued process work, device sessions, and spawned commands are **workstation-execution facts**. They are not model-worker counts and must not be promoted into reasoning-tier claims.

```text
Executor execution lane != reasoning agent
Executor connection != model entitlement
process count != reasoning depth
```

If Executor is used in future reasoning-surface experiments, the caller should provide explicit phase/model/surface labels and timestamps. Executor may preserve those labels as caller-supplied provenance, but should not infer them from sockets, child processes, or concurrency.

## No required implementation change

No Executor runtime change is justified by this experiment alone. The useful action is to preserve the semantic boundary and keep measurement/control evidence distinct from provider/model identity.
