/** Source-only bridge to Vera Mono's existing EffectFence authority.
 * The connector/backend must authenticate its own state readback externally.
 * This module cannot dispatch, commit, reconcile, mint permits, or sign effects.
 * Node >=20: no node:sqlite or other new runtime dependency.
 */
export const REVIEWED_MONO_HEAD = "16a2828dfa7fb7e6c0e19004f014bc68fc47badf";
export type MonoFenceState =
  "RESERVED" | "EXECUTING" | "ATTEMPTED_UNKNOWN" | "COMMITTED" |
  "CANCELLED_PRE_DISPATCH" | "RECONCILED_COMMITTED" | "RECONCILED_NO_EFFECT";
export type MonoFenceObservation = {
  sourceHead: string; deviceId: string; generation: number; connectedAt: number;
  effectId: string; requestDigest: string; state: MonoFenceState;
  resultDigest: string | null; reconciliationEvidenceDigest: string | null;
  transportSignal: "NONE" | "WEBSOCKET_SEND" | "HTTP_202";
};
export type ExpectedEffectSource = {
  deviceId: string; generation: number; connectedAt: number;
  effectId: string; requestDigest: string;
};
export type MonoSourceGate = {
  status: "HOLD" | "SOURCE_OBSERVATION_ONLY";
  reason: string;
  sourceState: MonoFenceState | null;
  dispatchAuthorized: false; retryAuthorized: false;
  applicationCompletionVerified: false; externalEffectVerified: false;
  reconciliationAuthorized: false;
};
const digest = (x: unknown): x is string =>
  typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const states = new Set<MonoFenceState>([
  "RESERVED","EXECUTING","ATTEMPTED_UNKNOWN","COMMITTED",
  "CANCELLED_PRE_DISPATCH","RECONCILED_COMMITTED","RECONCILED_NO_EFFECT"
]);
const hold = (reason: string, state: MonoFenceState | null = null): MonoSourceGate =>
  ({status:"HOLD",reason,sourceState:state,dispatchAuthorized:false,
    retryAuthorized:false,applicationCompletionVerified:false,
    externalEffectVerified:false,reconciliationAuthorized:false});
/** A sanity check for a *read-only observation*, NEVER a dispatch permit. */
export function assessMonoEffectSource(
  observation: unknown, expected: ExpectedEffectSource
): MonoSourceGate {
  if (!expected || typeof expected !== "object" ||
      typeof expected.deviceId !== "string" || !expected.deviceId ||
      typeof expected.effectId !== "string" || !expected.effectId ||
      !Number.isSafeInteger(expected.generation) || expected.generation < 1 ||
      !Number.isSafeInteger(expected.connectedAt) || expected.connectedAt < 1 ||
      !digest(expected.requestDigest)) return hold("INVALID_EXPECTATION");
  if (!observation || typeof observation !== "object" || Array.isArray(observation))
    return hold("MISSING_MONO_FENCE_SOURCE");
  const o = observation as Partial<MonoFenceObservation>;
  if (o.sourceHead !== REVIEWED_MONO_HEAD) return hold("UNREVIEWED_MONO_SOURCE_HEAD");
  if (o.deviceId !== expected.deviceId || o.generation !== expected.generation ||
      o.connectedAt !== expected.connectedAt) return hold("REPLACED_DEVICE_SESSION");
  if (o.effectId !== expected.effectId || o.requestDigest !== expected.requestDigest)
    return hold("EFFECT_OR_TASK_REQUEST_MISMATCH");
  if (!states.has(o.state as MonoFenceState)) return hold("INVALID_MONO_EFFECT_STATE");
  const state = o.state as MonoFenceState;
  if (!["NONE","WEBSOCKET_SEND","HTTP_202"].includes(o.transportSignal as string))
    return hold("INVALID_TRANSPORT_SIGNAL",state);
  if (o.resultDigest !== null && !digest(o.resultDigest))
    return hold("INVALID_RESULT_DIGEST",state);
  if (o.reconciliationEvidenceDigest !== null && !digest(o.reconciliationEvidenceDigest))
    return hold("INVALID_RECONCILIATION_DIGEST",state);
  if (state === "ATTEMPTED_UNKNOWN" || state === "EXECUTING")
    return hold("AMBIGUOUS_DISPATCH_REQUIRES_MONO_QUALIFIED_RECOVERY",state);
  if (state === "RESERVED") return hold("MONO_FENCE_ONLY_RESERVED",state);
  if (state === "COMMITTED" && !digest(o.resultDigest))
    return hold("COMMITTED_WITHOUT_RESULT_DIGEST",state);
  if (state === "CANCELLED_PRE_DISPATCH" && o.resultDigest !== null)
    return hold("CANCELLED_WITH_RESULT_DIGEST",state);
  if (state.startsWith("RECONCILED_") && !digest(o.reconciliationEvidenceDigest))
    return hold("RECONCILIATION_PROOF_MISSING",state);
  if (state === "RECONCILED_COMMITTED" && !digest(o.resultDigest))
    return hold("RECONCILED_COMMITTED_WITHOUT_RESULT",state);
  if (state === "RECONCILED_NO_EFFECT" && o.resultDigest !== null)
    return hold("NO_EFFECT_WITH_RESULT",state);
  // Even source-shaped terminal receipts can be forged. The only authoritative
  // readback must come from qualified Vera Mono runtime verification.
  return {status:"SOURCE_OBSERVATION_ONLY",reason:"RECEIVER_PROOF_AND_APPLICATION_EFFECT_UNVERIFIED",
    sourceState:state,dispatchAuthorized:false,retryAuthorized:false,
    applicationCompletionVerified:false,externalEffectVerified:false,
    reconciliationAuthorized:false};
}
