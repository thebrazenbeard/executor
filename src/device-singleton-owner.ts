import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Server } from "node:net";

/**
 * Diagnostic emitted by the process which successfully bound the singleton.
 * It is NOT a cryptographic attestation and must not be trusted from a log or
 * PID file alone. A future supervisor must independently witness process
 * identity and liveness before treating it as owner evidence.
 */
export interface DeviceSingletonOwnerReceipt {
  schema: "EXECUTOR_SINGLETON_OWNER_RECEIPT_V1";
  platform: "win32" | "linux";
  pid: number;
  node_time_origin_ms: number;
  emitted_at_ms: number;
  singleton_identifier: string;
  bound_address_sha256: string;
  process_generation: string;
}

export interface IndependentOwnerWitness {
  /** All values must come from a separate, trusted live process observation. */
  pid: number;
  platform: "win32" | "linux";
  /** Independent OS process-creation time, not a copy of Node timeOrigin. */
  os_process_created_epoch_ms: number;
  singleton_identifier: string;
  bound_address_sha256: string;
  process_generation: string;
  live: boolean;
}

function singletonAddress(identifier: string, platform: "win32" | "linux"): string {
  if (!/^[a-f0-9]{32}$/.test(identifier)) throw new Error("invalid singleton identifier");
  return platform === "win32" ? `\\\\.\\pipe\\ExecutorDevice-${identifier}` : `\0ExecutorDevice-${identifier}`;
}

/** Issue only from an actual listening server after acquireDeviceSingleton. */
export function issueDeviceSingletonOwnerReceipt(server: Server, identifier: string): DeviceSingletonOwnerReceipt {
  if (process.platform !== "win32" && process.platform !== "linux") throw new Error("unsupported singleton owner platform");
  const expected = singletonAddress(identifier, process.platform);
  if (!server.listening || server.address() !== expected) {
    throw new Error("cannot issue owner receipt without the exact bound singleton server");
  }
  return Object.freeze({
    schema: "EXECUTOR_SINGLETON_OWNER_RECEIPT_V1",
    platform: process.platform,
    pid: process.pid,
    node_time_origin_ms: performance.timeOrigin,
    emitted_at_ms: Date.now(),
    singleton_identifier: identifier,
    bound_address_sha256: createHash("sha256").update(expected).digest("hex"),
    process_generation: randomUUID()
  });
}

/**
 * Fail-closed comparison, not a discovery API. A caller must first obtain a
 * genuinely independent live witness, including a generation observed through
 * the trusted supervisor channel. Caller-supplied or copied receipts are not
 * independent evidence, even when this returns true.
 */
export function matchesIndependentOwnerWitness(
  receipt: DeviceSingletonOwnerReceipt,
  witness: IndependentOwnerWitness
): boolean {
  return receipt.schema === "EXECUTOR_SINGLETON_OWNER_RECEIPT_V1"
    && (receipt.platform === "win32" || receipt.platform === "linux")
    && Number.isSafeInteger(receipt.pid) && receipt.pid > 0
    && Number.isFinite(receipt.node_time_origin_ms) && receipt.node_time_origin_ms > 0
    && Number.isFinite(receipt.emitted_at_ms) && receipt.emitted_at_ms >= receipt.node_time_origin_ms
    && /^[a-f0-9]{32}$/.test(receipt.singleton_identifier)
    && /^[a-f0-9]{64}$/.test(receipt.bound_address_sha256)
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(receipt.process_generation)
    && receipt.bound_address_sha256 === createHash("sha256")
      .update(singletonAddress(receipt.singleton_identifier, receipt.platform)).digest("hex")
    && witness.live === true
    && witness.pid === receipt.pid
    && witness.platform === receipt.platform
    // Node's time origin is not identical to an OS process creation stamp.
    // Corroborate a short startup window; generation custody is separately
    // essential because PID plus a time window alone is not a unique identity.
    && Number.isFinite(witness.os_process_created_epoch_ms)
    && receipt.node_time_origin_ms - witness.os_process_created_epoch_ms >= -250
    && receipt.node_time_origin_ms - witness.os_process_created_epoch_ms <= 5_000
    && witness.singleton_identifier === receipt.singleton_identifier
    && witness.bound_address_sha256 === receipt.bound_address_sha256
    && witness.process_generation === receipt.process_generation;
}
