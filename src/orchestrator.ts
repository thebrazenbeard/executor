import { randomUUID } from "node:crypto";
import { LanePool } from "./lanes.js";
import { ExecutionEventLog } from "./execution-events.js";
import type { ExecutionEventStore } from "./execution-store.js";

export type WorkContextState = "queued" | "running" | "waiting-for-effect" | "completed" | "failed";

export type WorkContextRecord = {
  id: string;
  state: WorkContextState;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  effectDevice?: string;
  parentExecutionId?: string;
};

export class WorkContextOrchestrator {
  private readonly pool: LanePool;
  private readonly records = new Map<string, WorkContextRecord>();
  readonly events: ExecutionEventLog;

  constructor(capacity: number, store?: ExecutionEventStore) { this.pool = new LanePool(capacity); this.events = new ExecutionEventLog(200, store); }

  create(parentExecutionId?: string): WorkContextRecord {
    this.prune();
    const record: WorkContextRecord = { id: randomUUID(), state: "queued", createdAt: Date.now(), parentExecutionId };
    this.records.set(record.id, record);
    this.events.append(record.id, "created", { state: record.state }, parentExecutionId);
    return record;
  }

  async run<T>(laneId: string, work: () => Promise<T>): Promise<T> {
    const lane = this.require(laneId);
    return this.pool.run(async () => {
      lane.state = "running";
      lane.startedAt = Date.now();
      this.events.append(lane.id, "running", { state: lane.state, effectDevice: lane.effectDevice });
      try {
        const result = await work();
        lane.state = "completed";
        lane.finishedAt = Date.now();
        this.events.append(lane.id, "completed", { state: lane.state, effectDevice: lane.effectDevice });
        return result;
      } catch (error) {
        lane.state = "failed";
        lane.finishedAt = Date.now();
        this.events.append(lane.id, "failed", { state: lane.state, effectDevice: lane.effectDevice, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
  }

  bindEffect(laneId: string, deviceId: string) {
    const lane = this.require(laneId);
    lane.effectDevice = deviceId;
    lane.state = "waiting-for-effect";
    this.events.append(lane.id, "effect-bound", { state: lane.state, effectDevice: deviceId });
  }

  get(laneId: string) { return this.records.get(laneId); }
  list() { return [...this.records.values()]; }
  get activeCount() { return this.pool.activeCount; }
  get queuedCount() { return this.pool.queuedCount; }

  private prune() {
    if (this.records.size < 1024) return;
    const finished = [...this.records.values()]
      .filter(lane => lane.finishedAt !== undefined)
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const lane of finished.slice(0, Math.max(1, this.records.size - 1023))) this.records.delete(lane.id);
  }

  private require(id: string) {
    const lane = this.records.get(id);
    if (!lane) throw new Error("unknown upstream work context");
    return lane;
  }
}
