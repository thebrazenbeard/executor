# Executor device singleton owner receipt — source-only candidate

Scope: stacked on Executor Draft PR #30. This is a **diagnostic evidence aid for a future authorized deployment**, not an installation, process repair, identity certificate, permission change, or proof that the currently running Lappy agent owns any particular pipe.

After the Node device-agent successfully binds its named-pipe singleton, it logs an `EXECUTOR_SINGLETON_OWNER_RECEIPT_V1` record with:

- the issuing process PID and Node `performance.timeOrigin` (a process time origin, **not** independently verified OS creation time);
- the canonical service/device singleton identifier and SHA-256 of the OS binding address, without printing the raw URL or credential;
- a fresh per-process generation UUID, emitted only after the server reports listening.

The record is deliberately not saved as a PID file. On failure to acquire the singleton there is no success receipt. Linux does not start a new singleton in `device-agent.ts` under this patch; Linux helper behavior is test-only while Linux deployment policy remains unqualified.

## Consumption contract

`matchesIndependentOwnerWitness` is a fail-closed *comparison* utility. A trusted supervisor or separately qualified OS telemetry source must supply independent proof that the **same currently live** process, OS creation time (within a narrow five-second startup window of Node's time origin), singleton identity, address, and run-generation were observed. The generation must be bound to the exact child process output channel, not copied from an arbitrary log. Receipt text alone, a stale log line, a PID alone, a successful source test, or a caller-constructed witness must not be promoted to ownership proof. PIDs can be reused; the time window corroborates but does not uniquely identify a run.

**Security limitation:** a same-user attacker capable of modifying both receipt and alleged witness can forge a match; the comparator does not authenticate witness provenance. It also does not prevent a named-pipe squatter from binding first, fix installed orphans, or bind currently running legacy processes retroactively. For strong attestation a future independently reviewed supervisor must witness the child it starts through an authenticated channel and verify OS process creation/handle ownership, with rejection on conflicting generations. Never auto-kill a process based on a receipt mismatch.

## Evidence boundary

- Source-level compiler and synthetic comparator tests run on Linux.
- A Windows real named-pipe bind-and-receipt regression is included for future CI; a local Linux sandbox cannot establish Windows handle behavior.
- No host deployment, restart, pipe connection, process termination, credential access, or recovery of the installed runtime is authorized by this candidate.
