# Executor → Temporal V1 projection

Build Executor, then explicitly preview events from a known, trusted JSONL file:

```bash
npm run build
node dist/export-temporal.js --events-file /path/to/execution-events.jsonl
node dist/export-temporal.js --events-file /path/to/execution-events.jsonl --execution-id my-execution
```

The command writes NDJSON only to standard output. It does **not** append to Temporal, mutate Executor state, send network traffic, or enable a background sync. Its source is the persisted Executor journal, not the in-memory event cache. The caller chooses the file and must handle access controls and any subsequent import separately.

Before emitting anything, the preview validates all records, rejects duplicate projected event IDs, and sorts by canonical timestamp then stable ID. Invalid input fails without partial standard output.

Each output record uses Temporal V1 fields: a deterministic `executor:<encoded-execution-id>:<per-execution-seq>` ID; the canonical UTC form of Executor's `at` millisecond clock reading; `source: "executor"`; the original event `type`; a source `refs` identifier; and minimal metadata. The metadata explicitly labels `time_basis: executor.execution_event_log_append_clock` and `sequence_scope: execution`.

The arbitrary `data` payload is **never exported**, because it can contain secrets, command contents, and device-specific details. `parentExecutionId` is carried only as a lineage claim. The projector does not intentionally include credential or host fields. **However, execution IDs, parent IDs, event types, timestamps, and lineage themselves can reveal sensitive operational information**; treat preview output as potentially sensitive and do not publish it indiscriminately.

Important limits:

- `at` is sampled from the control-plane clock when an event is appended, **not** independent proof of when a workstation effect occurred. Clock quality is not attested.
- `seq` orders events within one execution only. It is not a global sequence and does not establish causality between executions.
- Executor can report `OUTCOME_UNKNOWN`; the projection must not reclassify it as `COMPLETED` or `FAILED`.
- The journal uses asynchronous persistence; an acknowledged in-memory event may not yet be present in the file. The preview does not certify completeness, disk durability, or runtime installation.
- The projector rejects records that cannot fit Temporal's V1 canonical timestamp or 64-KiB line limits. It does not repair invalid source records.
- Import/admission into an authoritative Temporal store is intentionally **not automated**. Such a consumer must independently verify source provenance, schema, duplicate-ID behavior, and authorization before writing.
