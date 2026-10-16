/** Source-only Executor gateway registration probe.
 * A receipt is returned ONLY for the exact currently mapped authenticated
 * WebSocket connection. It is a transport observation, never an authority grant.
 */
import { DeviceConnection, DeviceRegistry } from "./device-registry.js";

export type RegistrationProbe = { type: "registration-probe"; nonce: string };
export type RegistrationReceipt = {
  type: "registration-receipt";
  nonce: string;
  deviceId: string;
  registered: boolean;
  generation?: number;
  connectedAt?: number;
};

const NONCE = /^[a-f0-9]{32}$/;

export function parseRegistrationProbe(value: unknown): RegistrationProbe | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const p = value as Record<string, unknown>;
  if (p.type !== "registration-probe" || typeof p.nonce !== "string" || !NONCE.test(p.nonce)) return;
  if (Object.keys(p).length !== 2) return;
  return { type: "registration-probe", nonce: p.nonce };
}

/** Caller must only invoke this on a WebSocket after authenticated DeviceHello. */
export function gatewayRegistrationReceipt(
  registry: DeviceRegistry, connection: DeviceConnection, raw: unknown
): RegistrationReceipt | undefined {
  const probe = parseRegistrationProbe(raw);
  if (!probe) return;
  const current = registry.resolve(connection.id);
  const attachment = registry.describe(connection.id);
  if (!current || current.device !== connection || !attachment ||
      connection.socket.readyState !== connection.socket.OPEN ||
      current.generation !== attachment.generation) {
    return { type: "registration-receipt", nonce: probe.nonce,
      deviceId: connection.id, registered: false };
  }
  return {
    type: "registration-receipt", nonce: probe.nonce, deviceId: connection.id,
    registered: true, generation: attachment.generation,
    connectedAt: attachment.connectedAt
  };
}

/** Local proof status, NOT device authentication or permission to dispatch. */
export function classifyRegistrationReceipt(
  raw: unknown, expectedNonce: string, expectedDeviceId: string
): { status: "REGISTRY_SESSION_OBSERVED_UNATTESTED"; generation: number; connectedAt: number }
 | { status: "HELD"; reason: string } {
  const held = (reason: string) => ({ status: "HELD" as const, reason });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return held("invalid object");
  const p = raw as Record<string, unknown>;
  if (p.type !== "registration-receipt" || p.nonce !== expectedNonce ||
      !NONCE.test(expectedNonce) || p.deviceId !== expectedDeviceId) return held("wrong probe binding");
  if (p.registered !== true) return held("not registered to current connection");
  if (!Number.isSafeInteger(p.generation) || (p.generation as number) < 1 ||
      !Number.isSafeInteger(p.connectedAt) || (p.connectedAt as number) < 1) return held("invalid generation/session");
  if (Object.keys(p).sort().join(",") !== "connectedAt,deviceId,generation,nonce,registered,type") return held("unexpected receipt fields");
  return { status: "REGISTRY_SESSION_OBSERVED_UNATTESTED",
    generation: p.generation as number, connectedAt: p.connectedAt as number };
}
