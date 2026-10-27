import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectExecutionEventForTemporal } from "../temporal-projection.js";

test("projection preserves execution ordering scope and canonical UTC without payload", () => {
  const source = {
    executionId: "job:one",
    parentExecutionId: "parent",
    seq: 2,
    type: "OUTCOME_UNKNOWN",
    at: Date.UTC(2026, 9, 27, 12, 34, 56, 123),
    data: { password: "never export me", result: "unverified" },
  };
  const projected = projectExecutionEventForTemporal(source);
  assert.equal(projected.id, "executor:job%3Aone:2");
  assert.equal(projected.timestamp, "2026-10-27T12:34:56.123000Z");
  assert.equal(projected.source, "executor");
  assert.equal(projected.event, "OUTCOME_UNKNOWN");
  assert.deepEqual(projected.refs, ["executor:execution:job%3Aone"]);
  assert.deepEqual(projected.metadata, {
    time_basis: "executor.execution_event_log_append_clock",
    sequence_scope: "execution",
    execution_id: "job:one",
    sequence: 2,
    parent_execution_id: "parent",
  });
  assert.ok(!JSON.stringify(projected).includes("never export me"));
  assert.equal(source.data.password, "never export me");
  assert.deepEqual(projectExecutionEventForTemporal(source), projected);
});

test("projection leaves whole-second timestamps canonical and event IDs unambiguous", () => {
  const make = (executionId: string) => projectExecutionEventForTemporal({
    executionId, seq: 1, type: "started", at: 0, data: null,
  });
  assert.equal(make("x").timestamp, "1970-01-01T00:00:00Z");
  assert.notEqual(make("a:b").id, make("a%3Ab").id);
  assert.equal(make("x").metadata.sequence_scope, "execution");
});

test("projection rejects invalid or unrepresentable time and sequence", () => {
  const sample = { executionId: "x", seq: 1, type: "started", at: 0, data: {} };
  assert.throws(() => projectExecutionEventForTemporal({ ...sample, seq: 0 }), /sequence/);
  assert.throws(() => projectExecutionEventForTemporal({ ...sample, at: Number.NaN }), /timestamp/);
  assert.throws(() => projectExecutionEventForTemporal({ ...sample, at: Date.UTC(10000, 0, 1) }), /timestamp/);
  assert.throws(() => projectExecutionEventForTemporal({ ...sample, type: "" }), /type/);
});

test("explicit CLI preview reads saved Executor events without modifying source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "executor-temporal-preview-"));
  try {
    const input = path.join(dir, "events.jsonl");
    const original = [
      { executionId: "one", seq: 1, type: "started", at: 0, data: { token: "secret" } },
      { executionId: "two", seq: 1, type: "started", at: 1, data: {} },
      { executionId: "one", seq: 2, type: "OUTCOME_UNKNOWN", at: 2, data: { error: "sensitive" } },
    ].map(e => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(input, original, "utf8");
    const script = fileURLToPath(new URL("../export-temporal.js", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--events-file", input, "--execution-id", "one"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(result.stdout.trim(), "", JSON.stringify(result));
    const records = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(records.map(event => event.id), ["executor:one:1", "executor:one:2"]);
    assert.deepEqual(records.map(event => event.timestamp), ["1970-01-01T00:00:00Z", "1970-01-01T00:00:00.002000Z"]);
    assert.ok(!result.stdout.includes("secret"));
    assert.ok(!result.stdout.includes("sensitive"));
    assert.equal(await readFile(input, "utf8"), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI preview sorts by UTC instant, then stable ID rather than journal order", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "executor-temporal-order-"));
  try {
    const input = path.join(dir, "events.jsonl");
    const events = [
      { executionId: "late", seq: 1, type: "started", at: 1000, data: {} },
      { executionId: "b", seq: 1, type: "started", at: 0, data: {} },
      { executionId: "a", seq: 1, type: "started", at: 0, data: {} },
      { executionId: "fraction", seq: 1, type: "started", at: 1, data: {} },
    ];
    await writeFile(input, events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const script = fileURLToPath(new URL("../export-temporal.js", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--events-file", input], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n").map(line => JSON.parse(line).id), [
      "executor:a:1", "executor:b:1", "executor:fraction:1", "executor:late:1",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI preview rejects duplicate source IDs atomically and exposes no payload", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "executor-temporal-duplicate-"));
  try {
    const input = path.join(dir, "events.jsonl");
    const rows = [
      { executionId: "dup", seq: 1, type: "started", at: 0, data: { token: "do-not-emit" } },
      { executionId: "dup", seq: 1, type: "COMPLETED", at: 1, data: { token: "also-secret" } },
    ].map(e => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(input, rows, "utf8");
    const script = fileURLToPath(new URL("../export-temporal.js", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--events-file", input], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes("do-not-emit"));
    assert.ok(!result.stderr.includes("also-secret"));
    assert.equal(await readFile(input, "utf8"), rows);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
