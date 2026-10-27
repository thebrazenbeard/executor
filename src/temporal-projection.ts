import type { ExecutionEvent } from "./execution-events.js";

/** A read-only, lossy projection. It never exports the arbitrary execution payload. */
export type TemporalExecutionRecord = {
  id: string;
  timestamp: string;
  source: "executor";
  event: string;
  refs: string[];
  metadata: {
    time_basis: "executor.execution_event_log_append_clock";
    sequence_scope: "execution";
    execution_id: string;
    sequence: number;
    parent_execution_id?: string;
  };
};

function validString(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim() || Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new Error(`invalid ${field}`);
  }
}

/**
 * Turn a persisted Executor execution event into Temporal's V1 NDJSON schema.
 * This does not assert that the underlying workstation effect occurred.
 * `at` is the local clock sampled when Executor appended the in-memory event.
 * `seq` orders events only within its execution ID.
 */
export function projectExecutionEventForTemporal(event: ExecutionEvent): TemporalExecutionRecord {
  validString(event.executionId, "execution ID");
  validString(event.type, "event type");
  if (event.parentExecutionId !== undefined) validString(event.parentExecutionId, "parent execution ID");
  if (!Number.isSafeInteger(event.seq) || event.seq < 1) throw new Error("invalid execution sequence");
  if (!Number.isSafeInteger(event.at)) throw new Error("invalid execution timestamp");

  let utc: string;
  try { utc = new Date(event.at).toISOString(); }
  catch { throw new Error("invalid execution timestamp"); }
  // Temporal V1 canonical UTC has seconds, or exactly six fractional digits.
  // JavaScript Date has only millisecond precision.
  if (!/^\d{4}-/.test(utc) || utc.startsWith("0000-")) throw new Error("unrepresentable Temporal timestamp");
  const timestamp = utc.replace(/\.(\d{3})Z$/, (_whole, milliseconds: string) =>
    milliseconds === "000" ? "Z" : `.${milliseconds}000Z`);
  const encodedId = encodeURIComponent(event.executionId);
  const record: TemporalExecutionRecord = {
    id: `executor:${encodedId}:${event.seq}`,
    timestamp,
    source: "executor",
    event: event.type,
    refs: [`executor:execution:${encodedId}`],
    metadata: {
      time_basis: "executor.execution_event_log_append_clock",
      sequence_scope: "execution",
      execution_id: event.executionId,
      sequence: event.seq,
      ...(event.parentExecutionId === undefined ? {} : { parent_execution_id: event.parentExecutionId }),
    },
  };
  // Keep within Temporal's 64-KiB record boundary, including final newline.
  if (Buffer.byteLength(JSON.stringify(record) + "\n", "utf8") > 64 * 1024) {
    throw new Error("Temporal projection exceeds record size limit");
  }
  return record;
}
