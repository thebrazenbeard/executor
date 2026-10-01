import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { DeviceRequest, DeviceResponse, JsonRpc } from "./protocol.js";
import { LanePool } from "./lanes.js";
import type { DeviceProfile } from "./device-profile.js";

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
    readonly deviceProfile?: DeviceProfile
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
      if (this.socket.readyState !== this.socket.OPEN) return reject(new DeviceEffectError("device socket is not open", "FAILED"));
      const wire: DeviceRequest = { type: "request", requestId: randomUUID(), payload };
      this.socket.send(JSON.stringify(wire), err => err ? reject(new DeviceEffectError(err.message, "OUTCOME_UNKNOWN")) : resolve());
    }));
  }

  request(payload: JsonRpc, timeoutMs = 120_000): Promise<JsonRpc> {
    return this.execution.run(() => new Promise<JsonRpc>((resolve, reject) => {
      if (this.socket.readyState !== this.socket.OPEN) return reject(new DeviceEffectError("device socket is not open", "FAILED"));
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
  deviceProfile?: DeviceProfile;
};

export class DeviceRegistry {
  private devices = new Map<string, DeviceConnection>();
  private generations = new Map<string, number>();
  private connectedAt = new Map<string, number>();

  attach(device: DeviceConnection): number {
    const prior = this.devices.get(device.id);
    if (prior && prior !== device) prior.socket.close(4001, "replaced by newer connection");
    this.devices.set(device.id, device);
    const generation = (this.generations.get(device.id) ?? 0) + 1;
    this.generations.set(device.id, generation);
    this.connectedAt.set(device.id, Date.now());
    return generation;
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
    return {
      deviceId: id,
      generation: this.generations.get(id) ?? 0,
      connectedAt: this.connectedAt.get(id) ?? 0,
      executionCapacity: device.execution.limit,
      ...(device.deviceProfile ? { deviceProfile: device.deviceProfile } : {})
    };
  }
  list() { return [...this.devices.keys()].sort(); }
}
