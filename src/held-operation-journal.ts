import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";

/**
 * A deliberately non-executing, local replay hold for an operation intent.
 * It is NOT an authority grant, rollback-resistant fence, or effect receipt.
 */
export type HeldOperationIntent = Readonly<{
  operationId: string;
  payloadSha256: string;
  deviceId: string;
  installedSourceSha256: string;
}>;

export type HeldOperationRecord = HeldOperationIntent & Readonly<{
  schema: "EXECUTOR_HELD_OPERATION_V1";
  disposition: "HELD_NO_DISPATCH_AUTHORITY";
}>;

export type HeldOperationResult = Readonly<{
  outcome: "NEW_HELD" | "EXISTING_HELD";
  record: HeldOperationRecord;
}>;

export class HeldOperationJournalError extends Error {
  constructor(readonly code: "INVALID_INTENT" | "CONFLICT" | "INDETERMINATE", message: string) {
    super(message);
    this.name = "HeldOperationJournalError";
  }
}

const sha256Hex = /^[a-f0-9]{64}$/;
const operationIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
const deviceIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const intentKeys = ["deviceId", "installedSourceSha256", "operationId", "payloadSha256"];
const recordKeys = [...intentKeys, "disposition", "schema"].sort();

function exactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, i) => key === keys[i]);
}

function validateIntent(input: HeldOperationIntent): HeldOperationRecord {
  if (!input || typeof input !== "object" || Array.isArray(input) || !exactKeys(input, intentKeys)
    || typeof input.operationId !== "string" || !operationIdPattern.test(input.operationId)
    || typeof input.payloadSha256 !== "string" || !sha256Hex.test(input.payloadSha256)
    || typeof input.installedSourceSha256 !== "string" || !sha256Hex.test(input.installedSourceSha256)
    || typeof input.deviceId !== "string" || !deviceIdPattern.test(input.deviceId)) {
    throw new HeldOperationJournalError("INVALID_INTENT", "held intent fields must be canonical and bounded");
  }
  return {
    schema: "EXECUTOR_HELD_OPERATION_V1",
    disposition: "HELD_NO_DISPATCH_AUTHORITY",
    operationId: input.operationId,
    payloadSha256: input.payloadSha256,
    deviceId: input.deviceId,
    installedSourceSha256: input.installedSourceSha256
  };
}

function sameRecord(a: HeldOperationRecord, b: HeldOperationRecord): boolean {
  return a.schema === b.schema && a.disposition === b.disposition
    && a.operationId === b.operationId && a.payloadSha256 === b.payloadSha256
    && a.deviceId === b.deviceId && a.installedSourceSha256 === b.installedSourceSha256;
}

export class HeldOperationJournal {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory) || resolve(directory) !== directory) {
      throw new HeldOperationJournalError("INVALID_INTENT", "journal path must be absolute and normalized");
    }
  }

  private async requirePreprovisionedDirectory(): Promise<void> {
    // No recursive creation: walking a missing/untrusted ancestor could itself
    // cross a symlink before we have established the target directory's custody.
    const parsed = parse(this.directory);
    let current = parsed.root;
    const segments = this.directory.slice(parsed.root.length).split(sep).filter(Boolean);
    if (segments.length === 0) {
      throw new HeldOperationJournalError("INDETERMINATE", "journal cannot be a filesystem root");
    }
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      let stat;
      try { stat = await lstat(current); }
      catch { throw new HeldOperationJournalError("INDETERMINATE", "journal ancestry is missing or unreadable"); }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new HeldOperationJournalError("INDETERMINATE", "journal ancestry has a link or non-directory component");
      }

      if (process.platform !== "win32") {
        const rootOwnedStickyDirectory = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
        if ((stat.mode & 0o022) !== 0 && !rootOwnedStickyDirectory) {
          throw new HeldOperationJournalError("INDETERMINATE", "journal ancestry has untrusted write permissions");
        }
        if (index === segments.length - 1 &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) {
          throw new HeldOperationJournalError("INDETERMINATE", "journal directory must be private and owned by this process user");
        }
      }
    }
    // POSIX realpath independently catches link rebinding observed during the
    // traversal. Windows reparse/ACL and adversarial TOCTOU need host review.
    if (process.platform !== "win32") {
      let actual: string;
      try { actual = await realpath(this.directory); }
      catch { throw new HeldOperationJournalError("INDETERMINATE", "journal ancestry changed or became unreadable"); }
      if (actual !== this.directory) {
        throw new HeldOperationJournalError("INDETERMINATE", "journal ancestry is not canonical");
      }
    }
  }

  /** Never dispatches or upgrades a held record, even on an identical retry. */
  async reserve(input: HeldOperationIntent): Promise<HeldOperationResult> {
    const expected = validateIntent(input);
    await this.requirePreprovisionedDirectory();

    // The external identifier never becomes part of a filesystem path.
    const filename = createHash("sha256").update(expected.operationId, "utf8").digest("hex") + ".json";
    const path = join(this.directory, filename);
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return { outcome: "EXISTING_HELD", record: await this.readHeld(path, expected) };
    }

    try {
      await handle.writeFile(JSON.stringify(expected) + "\n", "utf8");
      await handle.sync();
    } catch {
      // Preserve partial writes: silently deleting/retrying a reservation is unsafe.
      throw new HeldOperationJournalError("INDETERMINATE", "reservation write was not confirmed; manual reconciliation required");
    } finally {
      await handle.close();
    }
    return { outcome: "NEW_HELD", record: expected };
  }

  private async readHeld(path: string, expected: HeldOperationRecord): Promise<HeldOperationRecord> {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unexpected file type");
      if (stat.size < 1 || stat.size > 2048) throw new Error("unexpected reservation size");
      // O_NOFOLLOW is a best-effort extra defense; lstat is not a full hostile-OS ACL.
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let body: string;
      try { body = await handle.readFile({ encoding: "utf8" }); }
      finally { await handle.close(); }
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || !exactKeys(parsed, recordKeys)) throw new Error("unexpected record structure");
      const candidate = parsed as HeldOperationRecord;
      if (candidate.schema !== "EXECUTOR_HELD_OPERATION_V1"
        || candidate.disposition !== "HELD_NO_DISPATCH_AUTHORITY") throw new Error("unexpected schema or disposition");
      const canonical = validateIntent({
        operationId: candidate.operationId,
        payloadSha256: candidate.payloadSha256,
        deviceId: candidate.deviceId,
        installedSourceSha256: candidate.installedSourceSha256
      });
      if (!sameRecord(candidate, canonical)) throw new Error("noncanonical record fields");
      if (!sameRecord(candidate, expected)) {
        throw new HeldOperationJournalError("CONFLICT", "operation ID already held for a different immutable intent");
      }
      return candidate;
    } catch (error) {
      if (error instanceof HeldOperationJournalError && error.code === "CONFLICT") throw error;
      throw new HeldOperationJournalError("INDETERMINATE", "existing reservation cannot be safely authenticated or read");
    }
  }
}
