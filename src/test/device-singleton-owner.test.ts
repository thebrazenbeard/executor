import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:net";
import { test } from "node:test";
import { acquireDeviceSingleton } from "../device-singleton.js";
import {
  issueDeviceSingletonOwnerReceipt,
  matchesIndependentOwnerWitness,
  type DeviceSingletonOwnerReceipt,
  type IndependentOwnerWitness
} from "../device-singleton-owner.js";

const supported = process.platform === "win32" || process.platform === "linux";

function receiptFixture(identifier: string): Server {
  // Pure contract fixture only: this does NOT prove OS handle ownership.
  const address = process.platform === "win32"
    ? `\\\\.\\pipe\\ExecutorDevice-${identifier}`
    : `\0ExecutorDevice-${identifier}`;
  return { listening: true, address: () => address } as unknown as Server;
}

function witnessFrom(receipt: DeviceSingletonOwnerReceipt): IndependentOwnerWitness {
  return {
    pid: receipt.pid,
    platform: receipt.platform,
    os_process_created_epoch_ms: receipt.node_time_origin_ms - 1,
    singleton_identifier: receipt.singleton_identifier,
    bound_address_sha256: receipt.bound_address_sha256,
    process_generation: receipt.process_generation,
    live: true
  };
}

test("owner receipt requires exact listening server identity (synthetic contract)", { skip: !supported }, () => {
  const identifier = randomBytes(16).toString("hex");
  const unattached = createServer();
  assert.throws(() => issueDeviceSingletonOwnerReceipt(unattached, identifier), /exact bound singleton server/);
  unattached.close();

  const server = receiptFixture(identifier);
  const receipt = issueDeviceSingletonOwnerReceipt(server, identifier);
  assert.equal(receipt.schema, "EXECUTOR_SINGLETON_OWNER_RECEIPT_V1");
  assert.equal(receipt.pid, process.pid);
  assert.equal(receipt.platform, process.platform);
  assert.equal(receipt.singleton_identifier, identifier);
  assert.match(receipt.bound_address_sha256, /^[a-f0-9]{64}$/);
  assert.equal(matchesIndependentOwnerWitness(receipt, witnessFrom(receipt)), true);
  assert.equal(issueDeviceSingletonOwnerReceipt(server, identifier.toUpperCase()).singleton_identifier, identifier);
  assert.throws(() => issueDeviceSingletonOwnerReceipt(server, "0".repeat(32)), /exact bound singleton server/);
});

test("a cached receipt cannot silently survive a PID reuse or new process generation", { skip: !supported }, () => {
  const identifier = randomBytes(16).toString("hex");
  const receipt = issueDeviceSingletonOwnerReceipt(receiptFixture(identifier), identifier);
  const witness = witnessFrom(receipt);
  assert.equal(matchesIndependentOwnerWitness(receipt, { ...witness, live: false }), false);
  assert.equal(matchesIndependentOwnerWitness(receipt, { ...witness, os_process_created_epoch_ms: witness.os_process_created_epoch_ms + 10_000 }), false);
  assert.equal(matchesIndependentOwnerWitness(receipt, { ...witness, os_process_created_epoch_ms: witness.os_process_created_epoch_ms - 10_000 }), false);
  assert.equal(matchesIndependentOwnerWitness(receipt, { ...witness, process_generation: "00000000-0000-4000-8000-000000000000" }), false);
  assert.equal(matchesIndependentOwnerWitness(receipt, { ...witness, pid: witness.pid + 1 }), false);
});

test("a receipt for a different singleton or forged address fails independent comparison", { skip: !supported }, () => {
  const identifier = randomBytes(16).toString("hex");
  const receipt = issueDeviceSingletonOwnerReceipt(receiptFixture(identifier), identifier);
  const witness = witnessFrom(receipt);
  assert.equal(matchesIndependentOwnerWitness(receipt, { ...witness, singleton_identifier: "a".repeat(32) }), false);
  assert.equal(matchesIndependentOwnerWitness(receipt, { ...witness, bound_address_sha256: "0".repeat(64) }), false);
  assert.equal(matchesIndependentOwnerWitness({ ...receipt, bound_address_sha256: "0".repeat(64) }, { ...witness, bound_address_sha256: "0".repeat(64) }), false);
  assert.equal(matchesIndependentOwnerWitness({ ...receipt, schema: "EXECUTOR_SINGLETON_OWNER_RECEIPT_V1", process_generation: "not-a-uuid" }, witness), false);
});

test("absent or malformed witness/receipt fails closed without throwing", { skip: !supported }, () => {
  const identifier = randomBytes(16).toString("hex");
  const receipt = issueDeviceSingletonOwnerReceipt(receiptFixture(identifier), identifier);
  const witness = witnessFrom(receipt);
  for (const missing of [undefined, null, false, 0, "not-an-object", []]) {
    assert.equal(matchesIndependentOwnerWitness(receipt, missing as unknown as IndependentOwnerWitness), false);
    assert.equal(matchesIndependentOwnerWitness(missing as unknown as DeviceSingletonOwnerReceipt, witness), false);
  }
});

test("Windows OS-backed lease receipt is emitted only after a real listen", { skip: process.platform !== "win32" }, async () => {
  const identifier = randomBytes(16).toString("hex");
  const server = await acquireDeviceSingleton(identifier);
  try {
    const receipt = issueDeviceSingletonOwnerReceipt(server, identifier);
    assert.equal(receipt.pid, process.pid);
    assert.equal(matchesIndependentOwnerWitness(receipt, witnessFrom(receipt)), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.throws(() => issueDeviceSingletonOwnerReceipt(server, identifier), /exact bound singleton server/);
});
