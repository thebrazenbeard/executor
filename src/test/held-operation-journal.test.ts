import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HeldOperationJournal, HeldOperationJournalError } from "../held-operation-journal.js";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const intent = {
  operationId: "op_canonical_001122334455",
  payloadSha256: digest("canonical intent bytes"),
  deviceId: "Lappy",
  installedSourceSha256: digest("observed installed bytes")
};

test("a held operation survives a fresh journal instance without dispatch or upgrade", async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-held-intent-"));
  const first = await new HeldOperationJournal(root).reserve(intent);
  const second = await new HeldOperationJournal(root).reserve(intent);
  assert.equal(first.outcome, "NEW_HELD");
  assert.equal(second.outcome, "EXISTING_HELD");
  assert.deepEqual(second.record, first.record);
  assert.equal(second.record.disposition, "HELD_NO_DISPATCH_AUTHORITY");
});

test("same ID with changed payload, device, or installed source refuses reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-held-intent-"));
  const journal = new HeldOperationJournal(root);
  await journal.reserve(intent);
  for (const different of [
    { ...intent, payloadSha256: digest("other") },
    { ...intent, deviceId: "VN1" },
    { ...intent, installedSourceSha256: digest("new binary") }
  ]) {
    await assert.rejects(journal.reserve(different), (err: unknown) =>
      err instanceof HeldOperationJournalError && err.code === "CONFLICT");
  }
});

test("partial or malformed persisted reservation is indeterminate, never re-created", async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-held-intent-"));
  const file = join(root, digest(intent.operationId) + ".json");
  await writeFile(file, "{\"schema\":", "utf8");
  await assert.rejects(new HeldOperationJournal(root).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");
  assert.equal(await readFile(file, "utf8"), "{\"schema\":");
});

test("path-like IDs and noncanonical digests are rejected before any reservation", async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-held-intent-"));
  const journal = new HeldOperationJournal(root);
  for (const bad of [
    { ...intent, operationId: "../../escape_not_allowed" },
    { ...intent, payloadSha256: "A".repeat(64) },
    { ...intent, deviceId: "VN1/../VN2" }
  ]) {
    await assert.rejects(journal.reserve(bad), (err: unknown) =>
      err instanceof HeldOperationJournalError && err.code === "INVALID_INTENT");
  }
});

test("existing held record cannot claim a different disposition or extra fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-held-intent-"));
  const file = join(root, digest(intent.operationId) + ".json");
  await writeFile(file, JSON.stringify({ ...intent, schema: "EXECUTOR_HELD_OPERATION_V1", disposition: "COMPLETED" }), "utf8");
  await assert.rejects(new HeldOperationJournal(root).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");

  await writeFile(file, JSON.stringify({ ...intent, schema: "EXECUTOR_HELD_OPERATION_V1",
    disposition: "HELD_NO_DISPATCH_AUTHORITY", authority: "self-asserted" }), "utf8");
  await assert.rejects(new HeldOperationJournal(root).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");

  await writeFile(file, "x".repeat(8192), "utf8");
  await assert.rejects(new HeldOperationJournal(root).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");
});

test("missing journal directory fails closed without creating it", async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-held-intent-"));
  const missing = join(root, "not-provisioned");
  await assert.rejects(new HeldOperationJournal(missing).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");
  await assert.rejects(stat(missing), { code: "ENOENT" });
});

test("a symlink ancestor cannot redirect the journal outside its configured root", { skip: process.platform === "win32" }, async () => {
  const inside = await mkdtemp(join(tmpdir(), "executor-inside-"));
  const outside = await mkdtemp(join(tmpdir(), "executor-outside-"));
  const escaped = join(outside, "held");
  await mkdir(escaped, { mode: 0o700 });
  await symlink(outside, join(inside, "link"), "dir");
  await assert.rejects(new HeldOperationJournal(join(inside, "link", "held")).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");
  assert.deepEqual(await readdir(escaped), []);
});

test("an existing world-writable journal or ancestor is not trusted", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-held-intent-"));
  await chmod(root, 0o777);
  await assert.rejects(new HeldOperationJournal(root).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");
  await chmod(root, 0o700);

  const shared = join(root, "shared");
  const held = join(shared, "held");
  await mkdir(shared, { mode: 0o700 });
  await mkdir(held, { mode: 0o700 });
  await chmod(shared, 0o777);
  await assert.rejects(new HeldOperationJournal(held).reserve(intent), (err: unknown) =>
    err instanceof HeldOperationJournalError && err.code === "INDETERMINATE");
  await chmod(shared, 0o700);
});
