import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { DeviceRequest, DeviceResponse, JsonRpc } from "./protocol.js";
import { LanePool } from "./lanes.js";

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
  private pendingNotifications = new Set<(reason: string) => void>();
  private retired = false;

  constructor(
    readonly id: string,
    readonly socket: WebSocket,
    executionCapacity: number,
    readonly initializeResult: Record<string, unknown> = {}
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

  notify(payload: JsonRpc): Promise<void> {
    return this.execution.run(() => new Promise<void>((resolve, reject) => {
      if (this.retired || this.socket.readyState !== this.socket.OPEN) return reject(new DeviceEffectError("device session retired or socket not open", "FAILED"));
      let settled = false;
      const rejectUnknown = (reason: string) => {
        if (settled) return;
        settled = true;
        this.pendingNotifications.delete(rejectUnknown);
        reject(new DeviceEffectError(reason, "OUTCOME_UNKNOWN"));
      };
      this.pendingNotifications.add(rejectUnknown);
      const wire: DeviceRequest = { type: "request", requestId: randomUUID(), payload };
      try {
        this.socket.send(JSON.stringify(wire), err => {
          if (err || this.retired) return rejectUnknown(err?.message ?? "device session retired during notification send");
          if (settled) return;
          settled = true;
          this.pendingNotifications.delete(rejectUnknown);
          resolve();
        });
      } catch (error) {
        rejectUnknown(error instanceof Error ? error.message : "device notification send threw");
      }
    }));
  }

  request(payload: JsonRpc, timeoutMs = 120_000): Promise<JsonRpc> {
    return this.execution.run(() => new Promise<JsonRpc>((resolve, reject) => {
      if (this.retired || this.socket.readyState !== this.socket.OPEN) return reject(new DeviceEffectError("device session retired or socket not open", "FAILED"));
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DeviceEffectError("device request timed out", "OUTCOME_UNKNOWN"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      const wire: DeviceRequest = { type: "request", requestId, payload };
      this.socket.send(JSON.stringify(wire), err => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new DeviceEffectError(err.message, "OUTCOME_UNKNOWN"));
      });
    }));
  }

  get activeCount() { return this.execution.activeCount; }
  get queuedCount() { return this.execution.queuedCount; }

  close(reason = "device disconnected") {
    this.retired = true;
    for (const rejectUnknown of [...this.pendingNotifications]) rejectUnknown(reason);
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
    if (prior && prior !== device) {
      prior.close("replaced by newer connection");
      prior.socket.close(4001, "replaced by newer connection");
    }
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
