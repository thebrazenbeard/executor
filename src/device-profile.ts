export type DeviceProfile = {
  kind: string;
  platform?: string;
  arch?: string;
  packageArch?: string;
  nodeVersion?: string;
  executionCapacity?: number;
};

const MAX_PROFILE_STRING = 128;

function optionalBoundedString(record: Record<string, unknown>, key: keyof DeviceProfile): string | undefined {
  const value = record[key as string];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_PROFILE_STRING) {
    throw new Error(`deviceProfile.${String(key)} must be a non-empty string of at most ${MAX_PROFILE_STRING} characters`);
  }
  return value;
}

export function parseDeviceProfile(value: unknown): DeviceProfile | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("deviceProfile must be an object");
  }

  const record = value as Record<string, unknown>;
  const kind = optionalBoundedString(record, "kind");
  if (!kind) throw new Error("deviceProfile.kind is required");

  const executionCapacity = record.executionCapacity;
  if (
    executionCapacity !== undefined
    && (typeof executionCapacity !== "number"
      || !Number.isInteger(executionCapacity)
      || executionCapacity <= 0)
  ) {
    throw new Error("deviceProfile.executionCapacity must be a positive integer");
  }

  return {
    kind,
    ...(optionalBoundedString(record, "platform") ? { platform: optionalBoundedString(record, "platform") } : {}),
    ...(optionalBoundedString(record, "arch") ? { arch: optionalBoundedString(record, "arch") } : {}),
    ...(optionalBoundedString(record, "packageArch") ? { packageArch: optionalBoundedString(record, "packageArch") } : {}),
    ...(optionalBoundedString(record, "nodeVersion") ? { nodeVersion: optionalBoundedString(record, "nodeVersion") } : {}),
    ...(executionCapacity === undefined ? {} : { executionCapacity })
  };
}

export function effectiveDeviceCapacity(controlPlaneCeiling: number, profile?: DeviceProfile): number {
  if (!Number.isInteger(controlPlaneCeiling) || controlPlaneCeiling <= 0) {
    throw new Error("controlPlaneCeiling must be a positive integer");
  }
  return Math.min(controlPlaneCeiling, profile?.executionCapacity ?? controlPlaneCeiling);
}
