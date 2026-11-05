# Held operation IDs — local no-dispatch probe

Status: **SOURCE ONLY / DRAFT / NOT INSTALLED / NO EFFECT AUTHORITY**.
Coordination: `project_unfuck_runtime_coordination`, VCP [#164](https://github.com/thebrazenbeard/vera-control-plane/pull/164).

`src/held-operation-journal.ts` is an **isolated** helper; no server, device agent,
MCP tool, HTTP route, or credential path imports it. It records a canonical
`operationId`, `payloadSha256`, `deviceId`, and *claimed* `installedSourceSha256`
in an exclusive-create JSON file. A repeated matching ID returns the prior
`HELD_NO_DISPATCH_AUTHORITY` record; the same ID with a different immutable
intent fails `CONFLICT`. Malformed or partially written prior records fail
`INDETERMINATE` and are preserved for human reconciliation. No method can
dispatch an effect, clear a hold, or mark a result `COMPLETED`.

The journal directory must exist before invocation and, on POSIX, be owned
by the current user with private permissions. All existing path components
are inspected for symlinks and unsafe shared write access. Root-owned sticky
directories such as `/tmp` are an explicit ancestor exception. The helper
never recursively creates an untrusted path. A Windows path/reparse check is
best-effort only; Node's POSIX mode does **not** establish Windows ACL custody.

## Evidence and limits

- The source test uses a real temporary filesystem, new store instances,
  mismatched payload/device/source, corrupt files and path-like identifiers.
- Local file persistence is useful for *process restart* observation, not an
  authenticated, rollback-resistant external receipt or exactly-once execution.
  A local backup restore or deletion can remove the reservation; disk or
  directory fsync and malicious same-user filesystem interference/TOCTOU are
  not independently qualified. An existing file can also be unreadable during a
  concurrent initial write, in which case the consumer must hold, not replay.
- `installedSourceSha256` is **caller-supplied**, not a verified loaded-binary
  identity. Neither `operationId` nor the device ID authenticates a principal.
  The future host-owned verifier must independently witness those claims.
- The optional adapter needs independently authenticated holder/grant/lease
  evidence, a host-owned monotone fence, a durable exact-receipt store, and a
  conservative `OUTCOME_UNKNOWN` reconciliation path before protected dispatch.
- Do **not** route protected intents, secrets, receipts, or consent through the
  public communication Bus. No production configuration is changed here.

## Local qualification

```bash
npm ci --offline --ignore-scripts
npm test
```

The tests exercise **only the held, no-dispatch contract**, not live Executor
runtime consumption or a Portal→Runner→Executor end-to-end operation.
