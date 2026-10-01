export const QUALIFICATION_EXECUTION_FLOOR = 4;
export const QUALIFICATION_UPSTREAM_CONTEXT_FLOOR = 32;

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export type CapacityConfig = {
  executionPerDevice: number;
  upstreamContexts: number;
};

export function capacityConfig(env: NodeJS.ProcessEnv = process.env): CapacityConfig {
  return {
    executionPerDevice: positiveInt("EXECUTOR_EXECUTION_CAPACITY", env.EXECUTOR_EXECUTION_CAPACITY, QUALIFICATION_EXECUTION_FLOOR),
    upstreamContexts: positiveInt("EXECUTOR_UPSTREAM_CONTEXT_CAPACITY", env.EXECUTOR_UPSTREAM_CONTEXT_CAPACITY ?? env.EXECUTOR_LOGIC_CAPACITY, QUALIFICATION_UPSTREAM_CONTEXT_FLOOR)
  };
}

export function qualificationStatus(config: CapacityConfig) {
  return {
    executionFloor: QUALIFICATION_EXECUTION_FLOOR,
    upstreamContextFloor: QUALIFICATION_UPSTREAM_CONTEXT_FLOOR,
    executionMeetsFloor: config.executionPerDevice >= QUALIFICATION_EXECUTION_FLOOR,
    upstreamContextMeetsFloor: config.upstreamContexts >= QUALIFICATION_UPSTREAM_CONTEXT_FLOOR
  };
}
