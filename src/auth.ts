import { timingSafeEqual } from "node:crypto";

function equalSecret(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function bearerAuthorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return equalSecret(header.slice(7), expected);
}

export function tokenAuthorized(actual: string, expected: string): boolean {
  return equalSecret(actual, expected);
}

export type DeviceTokenMap = ReadonlyMap<string, string>;

export function parseDeviceTokens(raw: string | undefined): DeviceTokenMap {
  if (!raw?.trim()) return new Map();
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EXECUTOR_DEVICE_TOKENS_JSON must be a JSON object");
  }

  const tokens = new Map<string, string>();
  for (const [deviceId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId)) {
      throw new Error(`invalid device id in EXECUTOR_DEVICE_TOKENS_JSON: ${deviceId}`);
    }
    if (typeof value !== "string" || value.length < 1) {
      throw new Error(`device token for ${deviceId} must be a non-empty string`);
    }
    tokens.set(deviceId, value);
  }
  return tokens;
}

export function deviceTokenAuthorized(
  deviceId: string,
  actual: string,
  sharedToken: string,
  perDeviceTokens: DeviceTokenMap
): boolean {
  const bound = perDeviceTokens.get(deviceId);
  if (bound !== undefined) return equalSecret(actual, bound);
  return sharedToken.length > 0 && equalSecret(actual, sharedToken);
}
