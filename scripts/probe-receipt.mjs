import { randomBytes } from "node:crypto";

export const PROBE_NONCE_PLACEHOLDER = "{probe_nonce}";

/** Bind the requested start_process operation to one unpredictable stdout marker. */
export function newProbeCommand(template, index) {
  if (typeof template !== "string" || template.split(PROBE_NONCE_PLACEHOLDER).length !== 2) {
    throw new Error("EXECUTOR_REMOTE_PROBE_COMMAND must contain exactly one {probe_nonce} placeholder");
  }
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("invalid probe operation index");
  const marker = `EXECUTOR_START_PROCESS_${index}_${randomBytes(16).toString("hex")}`;
  return { command: template.replace(PROBE_NONCE_PLACEHOLDER, marker), marker };
}

/** MCP success alone is not an execution witness: require the exact returned stdout line. */
export function hasExactProbeOutput(result, marker) {
  if (result?.isError || !Array.isArray(result?.content) || typeof marker !== "string") return false;
  return result.content.some(block =>
    block?.type === "text" && typeof block.text === "string" &&
    block.text.split(/\r?\n/).some(line => line.trim() === marker)
  );
}
