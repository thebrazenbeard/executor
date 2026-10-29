import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { DeviceRequest, DeviceResponse, JsonRpc } from "./protocol.js";
import { LanePool, LaneQueueTimeoutError } from "./lanes.js";

export class DeviceEffectError extends Error {
  constructor(message: string, readonly disposition: "FAILED" | "OUTCOME_UNKNOWN") { super(message); this.name = "DeviceEffectError"; }
}

type Pending = {
  resolve: (value: JsonRpc) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export class DeviceConnection {
  readonly execution: LanePool;
  private pending = new Map<string, Pending>();

  constructor(
    readonly id: string,
    readonly socket: WebSocket,
    executionCapacity: number,
    readonly initializeResult: Record<string, unknown> = {},
    readonly credentialDigest?: Buffer
  ) {
    this.execution = new LanePool(executionCapacity);
  }

  accept(message: DeviceResponse) {
    const p = this.pending.get(message.requestId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(message.requestId);
    p.resolve(message.payload);
  }

  notify(payload: JsonRpc, timeoutMs = 120_000, onDispatchAttempt?: () => void): Promise<void> {
    const started = performance.now();
    return this.execution.run(() => new Promise<void>((resolve, reject) => {
      if (this.socket.readyState !== this.socket.OPEN) return reject(new DeviceEffectError("device socket is not open", "FAILED"));
      const remaining = timeoutMs - (performance.now() - started);
      if (remaining <= 0) return reject(new DeviceEffectError("device admission deadline expired", "FAILED"));
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new DeviceEffectError("device notification send timed out", "OUTCOME_UNKNOWN"));
      }, remaining);
      const wire: DeviceRequest = { type: "request", requestId: randomUUID(), payload };
      let encoded: string;
      try { encoded = JSON.stringify(wire); }
      catch {
        settled = true;
        clearTimeout(timer);
        return reject(new DeviceEffectError("device payload serialization failed", "FAILED"));
      }
      try { onDispatchAttempt?.(); }
      catch {
        settled = true;
        clearTimeout(timer);
        return reject(new DeviceEffectError("device dispatch marker failed", "FAILED"));
      }
      try {
        this.socket.send(encoded, err => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          return err ? reject(new DeviceEffectError("device socket send failed", "OUTCOME_UNKNOWN")) : resolve();
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new DeviceEffectError("device socket send threw", "OUTCOME_UNKNOWN"));
        }
      }
    }), timeoutMs).catch(error => {
      if (error instanceof LaneQueueTimeoutError) throw new DeviceEffectError("device admission deadline expired", "FAILED");
      throw error;
    });
  }

  request(payload: JsonRpc, timeoutMs = 120_000, onDispatchAttempt?: () => void): Promise<JsonRpc> {
    const started = performance.now();
    return this.execution.run(() => new Promise<JsonRpc>((resolve, reject) => {
      if (this.socket.readyState !== this.socket.OPEN) return reject(new DeviceEffectError("device socket is not open", "FAILED"));
      // The deadline includes time queued for a device lane. A request that
      // never reached the socket is a known FAILED admission, not an unknown
      // remote effect. Once dispatched, a timeout remains OUTCOME_UNKNOWN.
      const remaining = timeoutMs - (performance.now() - started);
      if (remaining <= 0) return reject(new DeviceEffectError("device admission deadline expired", "FAILED"));
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DeviceEffectError("device request timed out", "OUTCOME_UNKNOWN"));
      }, remaining);
      this.pending.set(requestId, { resolve, reject, timer });
      const wire: DeviceRequest = { type: "request", requestId, payload };
      let encoded: string;
      try { encoded = JSON.stringify(wire); }
      catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        return reject(new DeviceEffectError("device payload serialization failed", "FAILED"));
      }
      try { onDispatchAttempt?.(); }
      catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        return reject(new DeviceEffectError("device dispatch marker failed", "FAILED"));
      }
      try {
        this.socket.send(encoded, err => {
          if (!err) return;
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(new DeviceEffectError("device socket send failed", "OUTCOME_UNKNOWN"));
        });
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new DeviceEffectError("device socket send threw", "OUTCOME_UNKNOWN"));
      }
    }), timeoutMs).catch(error => {
      if (error instanceof LaneQueueTimeoutError) throw new DeviceEffectError("device admission deadline expired", "FAILED");
      throw error;
    });
  }

  get activeCount() { return this.execution.activeCount; }
  get queuedCount() { return this.execution.queuedCount; }

  close(reason = "device disconnected") {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new DeviceEffectError(reason, "OUTCOME_UNKNOWN"));
      this.pending.delete(id);
    }
  }
}

export type DeviceAttachment = {
  deviceId: string;
  generation: number;
  connectedAt: number;
  executionCapacity: number;
};

export class DeviceRegistry {
  private devices = new Map<string, DeviceConnection>();
  private generations = new Map<string, number>();
  private connectedAt = new Map<string, number>();

  attach(device: DeviceConnection) {
    const prior = this.devices.get(device.id);
    if (prior && prior !== device) prior.socket.close(4001, "replaced by newer connection");
    this.devices.set(device.id, device);
    this.generations.set(device.id, (this.generations.get(device.id) ?? 0) + 1);
    this.connectedAt.set(device.id, Date.now());
  }

  detach(device: DeviceConnection) {
    if (this.devices.get(device.id) === device) this.devices.delete(device.id);
    device.close();
  }

  get(id: string) { return this.devices.get(id); }
  resolve(id: string) {
    const device = this.devices.get(id);
    if (!device) return undefined;
    return { device, generation: this.generations.get(id) ?? 0 };
  }
  getIfGeneration(id: string, generation: number) {
    return this.generations.get(id) === generation ? this.devices.get(id) : undefined;
  }
  describe(id: string): DeviceAttachment | undefined {
    const device = this.devices.get(id);
    if (!device) return undefined;
    return { deviceId: id, generation: this.generations.get(id) ?? 0, connectedAt: this.connectedAt.get(id) ?? 0, executionCapacity: device.execution.limit };
  }
  list() { return [...this.devices.keys()].sort(); }
}
