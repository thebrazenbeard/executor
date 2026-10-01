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
Executor remote ingress
       |
       | authenticated device attachment
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

Executor keeps upstream request concurrency separate from workstation-effect concurrency.

- **Execution lanes:** configurable per-device concurrency for workstation effects. The inherited qualification floor/default is 4.
- **Upstream contexts:** configurable concurrent request/admission contexts. The inherited qualification floor/default is 32.
- **No authority multiplication:** increasing concurrency does not create additional permissions.
- **Resource serialization:** operations that target the same protected resource may be serialized without changing their semantic authority.

## Failure semantics

Executor distinguishes three important states:

- **FAILED** — the effect was not dispatched or is known not to have occurred.
- **SUCCEEDED** — a result was observed for the dispatched effect.
- **OUTCOME_UNKNOWN** — the effect may have occurred, but the connection failed or timed out after dispatch.

`OUTCOME_UNKNOWN` effects are never silently replayed. Reconciliation must establish current state first.

## Repository lineage

Executor starts from:

- `thebrazenbeard/workbridgecommander` — remote MCP ingress, device attachment, lane orchestration, effect ledger, and Commander plugin surface.
- `thebrazenbeard/workbridge` — donor research for hardened path/currentness/concurrency and relay operational lessons. Its bounded executable-grant runtime is **not** part of Executor.
- `thebrazenbeard/WorkBridgeMCP` — donor research for exact Desktop Commander source pinning, qualification, process/session parity, and the rule that transport must not semantically narrow the workstation payload.

Exact donor heads are recorded in [PROVENANCE.md](PROVENANCE.md).

## Status

Source construction is in progress on `build/executor-v1`. Repository source, installed workstation payload, live device attachment, public deployment, and end-to-end runtime proof are separate evidence classes and must not be conflated.
