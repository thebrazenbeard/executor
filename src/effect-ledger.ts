export type EffectDisposition =
  | "QUEUED"
  | "ADMITTED"
  | "DISPATCHED"
  | "COMPLETED"
  | "FAILED"
  | "OUTCOME_UNKNOWN";

const ALLOWED_TRANSITIONS: Record<EffectDisposition, readonly EffectDisposition[]> = {
  QUEUED: ["ADMITTED", "FAILED"],
  ADMITTED: ["DISPATCHED", "FAILED"],
  DISPATCHED: ["COMPLETED", "FAILED", "OUTCOME_UNKNOWN"],
  COMPLETED: [],
  FAILED: [],
  OUTCOME_UNKNOWN: []
};

export type EffectRecord = {
  requestId: string;
  deviceId: string;
  generation: number;
  disposition: EffectDisposition;
  replaySafe: boolean;
  updatedAt: number;
};

export class EffectLedger {
  private records = new Map<string, EffectRecord>();
  constructor(private readonly maxRecords = 10_000) {
    if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error("maxRecords must be a positive integer");
  }

  create(requestId: string, deviceId: string, generation: number, replaySafe = false) {
    if (this.records.has(requestId)) throw new Error("duplicate effect ID already exists");
    const record: EffectRecord = { requestId, deviceId, generation, disposition: "QUEUED", replaySafe, updatedAt: Date.now() };
    this.records.set(requestId, record);
    while (this.records.size > this.maxRecords) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
    return record;
  }

  transition(requestId: string, disposition: EffectDisposition) {
    const record = this.records.get(requestId);
    if (!record) throw new Error("unknown effect");
    if (!ALLOWED_TRANSITIONS[record.disposition].includes(disposition))
      throw new Error("invalid effect state transition from " + record.disposition + " to " + disposition);
    record.disposition = disposition;
    record.updatedAt = Date.now();
    return record;
  }

  get(requestId: string) { return this.records.get(requestId); }
  recent(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("effect ledger limit must be 1..1000");
    return [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
}
