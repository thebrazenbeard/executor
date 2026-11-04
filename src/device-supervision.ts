import { connect } from "node:net";
import { deviceSingletonIdentifier } from "./device-singleton.js";

export type TaskObservation = "running" | "not-running" | "unknown";
export type LeaseObservation = "connected" | "not-observed" | "unknown";

/** Require the one exact root task. Name-only TaskScheduler matches can span paths. */
export function parseScheduledTaskObservation(value: unknown): TaskObservation {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  if (rows.length !== 1) return "unknown";
  const row = rows[0] as Record<string, unknown>;
  if (row.TaskName !== "Executor Device" || row.TaskPath !== "\\") return "unknown";
  if (row.State === "Running") return "running";
  if (row.State === "Ready" || row.State === "Disabled") return "not-running";
  return "unknown";
}

export type SupervisionState =
  | "TASK_AND_LEASE_PRESENT"
  | "POSSIBLE_ORPHAN"
  | "TASK_WITHOUT_LEASE"
  | "LEASE_NOT_OBSERVED"
  | "INDETERMINATE";

export function classifyDeviceSupervision(
  task: TaskObservation,
  lease: LeaseObservation
): { state: SupervisionState; safeToStart: false } {
  let state: SupervisionState = "INDETERMINATE";
  if (task === "running" && lease === "connected") state = "TASK_AND_LEASE_PRESENT";
  else if (task === "not-running" && lease === "connected") state = "POSSIBLE_ORPHAN";
  else if (task === "running" && lease === "not-observed") state = "TASK_WITHOUT_LEASE";
  else if (task === "not-running" && lease === "not-observed") state = "LEASE_NOT_OBSERVED";
  // Absence of this lease does NOT prove the absence of legacy unguarded agents.
  // This diagnostic must never authorize a replacement agent or process kill.
  return { state, safeToStart: false };
}

/**
 * Non-disruptive observation of the PR30 Windows agent-owned named pipe.
 * A connected socket proves that a listener exists, not who owns it or that
 * the MCP/tunnel is operational. EACCES, timeout, and all unfamiliar failures
 * stay unknown rather than being mistaken for an absent agent.
 */
export async function probeWindowsDeviceLease(
  serviceUrl: string,
  deviceId: string,
  timeoutMs = 1200
): Promise<LeaseObservation> {
  if (process.platform !== "win32") return "unknown";
  const identifier = deviceSingletonIdentifier(serviceUrl, deviceId);
  const pipe = `\\\\.\\pipe\\ExecutorDevice-${identifier}`;

  return await new Promise<LeaseObservation>(resolve => {
    let settled = false;
    const socket = connect(pipe);
    const finish = (result: LeaseObservation): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish("unknown"), timeoutMs);
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ENOENT" ? "not-observed" : "unknown");
    });
  });
}
