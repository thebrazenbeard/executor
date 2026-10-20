/** Source-only SQLite effect hold journal. NOT wired to the installed gateway.
 * Node >=22.13 required for node:sqlite; runtime adoption needs a separate gate.
 * The journal records intent BEFORE dispatch, never executes or replays effects.
 */
import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import { closeSync, lstatSync, openSync } from "node:fs";

type State = "QUEUED" | "DISPATCHED" | "OUTCOME_UNKNOWN" | "FAILED_BEFORE_DISPATCH";
export type DurableEffectRecord = {
  effectId: string;
  deviceId: string;
  generation: number;
  connectedAt: number;
  taskDigest: string;
  state: State;
};
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function validate(effectId: string, deviceId: string, generation: number,
                  connectedAt: number, taskDigest: string) {
  if (typeof effectId !== "string" || !ID.test(effectId) ||
      typeof deviceId !== "string" || !ID.test(deviceId) ||
      !Number.isSafeInteger(generation) || generation < 1 ||
      !Number.isSafeInteger(connectedAt) || connectedAt < 1 ||
      typeof taskDigest !== "string" || !DIGEST.test(taskDigest))
    throw new Error("invalid typed effect identity/session/digest");
}

export class DurableEffectHoldJournal {
  private db: DatabaseSync;
  constructor(dbPath: string, options: { initializeNew?: boolean } = {}) {
    if (typeof dbPath !== "string" || !isAbsolute(dbPath))
      throw new Error("effect journal requires a separate absolute database path");
    if (!options || typeof options !== "object" ||
        (options.initializeNew !== undefined && typeof options.initializeNew !== "boolean"))
      throw new Error("invalid journal initialization option");
    const initialize = options.initializeNew === true;
    if (initialize) {
      // Explicit one-time provisioning. "wx" forbids replacing an existing DB.
      const fd = openSync(dbPath, "wx", 0o600);
      closeSync(fd);
    } else {
      let info;
      try { info = lstatSync(dbPath); }
      catch { throw new Error("missing effect journal: recovery cannot silently initialize"); }
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0)
        throw new Error("invalid or empty effect journal: recovery held");
    }
    this.db = new DatabaseSync(dbPath);
    try {
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
      if (initialize) {
        this.db.exec(`CREATE TABLE vn1_effect_hold (
          effect_id TEXT PRIMARY KEY NOT NULL,
          device_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          connected_at INTEGER NOT NULL,
          task_digest TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN
           ('QUEUED','DISPATCHED','OUTCOME_UNKNOWN','FAILED_BEFORE_DISPATCH'))
        ) STRICT; PRAGMA user_version = 1;`);
      } else {
        const ver = this.db.prepare("PRAGMA user_version").get() as Record<string,unknown> | undefined;
        const table = this.db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='vn1_effect_hold'"
        ).get();
        if (ver?.user_version !== 1 || !table)
          throw new Error("unrecognized effect journal schema: recovery held");
      }
      const check = this.db.prepare("PRAGMA quick_check").get() as Record<string,unknown> | undefined;
      if (!check || Object.values(check)[0] !== "ok")
        throw new Error("effect journal integrity unverified");
    } catch (error) {
      // Windows holds SQLite files open until explicitly closed on invalid DB.
      this.db.close();
      throw error;
    }
  }
  close() { this.db.close(); }

  create(effectId: string, deviceId: string, generation: number,
         connectedAt: number, taskDigest: string): DurableEffectRecord {
    validate(effectId,deviceId,generation,connectedAt,taskDigest);
    // SQLite PRIMARY KEY is durable across process reopen. No upsert/replacement.
    this.db.prepare(`INSERT INTO vn1_effect_hold
      (effect_id,device_id,generation,connected_at,task_digest,state)
      VALUES (?,?,?,?,?,'QUEUED')`).run(effectId,deviceId,generation,connectedAt,taskDigest);
    return this.getRequired(effectId);
  }
  get(effectId: string): DurableEffectRecord | undefined {
    if (typeof effectId !== "string" || !ID.test(effectId)) throw new Error("invalid effect id");
    const row = this.db.prepare(`SELECT effect_id AS effectId,device_id AS deviceId,
      generation,connected_at AS connectedAt,task_digest AS taskDigest,state
      FROM vn1_effect_hold WHERE effect_id=?`).get(effectId) as
      (Record<string,unknown> | undefined);
    if (!row) return undefined;
    validate(row.effectId as string,row.deviceId as string,row.generation as number,
      row.connectedAt as number,row.taskDigest as string);
    if (!["QUEUED","DISPATCHED","OUTCOME_UNKNOWN","FAILED_BEFORE_DISPATCH"].includes(row.state as string))
      throw new Error("unknown stored effect state");
    return row as DurableEffectRecord;
  }
  private getRequired(effectId: string): DurableEffectRecord {
    const rec=this.get(effectId);
    if (!rec) throw new Error("effect journal record absent");
    return rec;
  }
  private cas(effectId: string, deviceId: string, generation: number, connectedAt: number,
              taskDigest: string, from: State, to: State): DurableEffectRecord {
    validate(effectId,deviceId,generation,connectedAt,taskDigest);
    const updated=this.db.prepare(`UPDATE vn1_effect_hold SET state=?
      WHERE effect_id=? AND device_id=? AND generation=?
      AND connected_at=? AND task_digest=? AND state=?`)
      .run(to,effectId,deviceId,generation,connectedAt,taskDigest,from);
    if (updated.changes !== 1) throw new Error("effect CAS failed: stale session or state");
    return this.getRequired(effectId);
  }
  // Must be durably recorded BEFORE caller attempts any external operation.
  markDispatchIntent(record: DurableEffectRecord): DurableEffectRecord {
    return this.cas(record.effectId,record.deviceId,record.generation,
      record.connectedAt,record.taskDigest,"QUEUED","DISPATCHED");
  }
  holdAmbiguous(record: DurableEffectRecord): DurableEffectRecord {
    return this.cas(record.effectId,record.deviceId,record.generation,
      record.connectedAt,record.taskDigest,"DISPATCHED","OUTCOME_UNKNOWN");
  }
  failBeforeDispatch(record: DurableEffectRecord): DurableEffectRecord {
    return this.cas(record.effectId,record.deviceId,record.generation,
      record.connectedAt,record.taskDigest,"QUEUED","FAILED_BEFORE_DISPATCH");
  }
  // No method to promote to COMPLETED, erase UNKNOWN, or automatically replay.
  // A receiver-authenticated application ACK contract must be separately designed.
}
