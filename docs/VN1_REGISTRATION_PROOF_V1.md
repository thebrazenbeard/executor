# VN1 gateway registration-proof candidate — source-only V1

Status: DRAFT source experiment. No installation, production activation, credential change, model route, Windows scheduled task, or restart was performed.

## Failure addressed
The existing VN1 Keeper reports a locally healthy agent when there is one device-agent PID and at least one ESTABLISHED gateway TCP socket. That does not imply Executor's DeviceRegistry still maps that WebSocket. A gateway-registered generation and session are independent facts.

## Mechanism
After the already authenticated DeviceHello handshake on the device WebSocket, an opt-in client sends a fresh 128-bit nonce in a strict registration-probe packet. The gateway consults the exact DeviceRegistry mapping, its connection object and socket readiness, then replies with that nonce, device ID, gateway-generated generation and connectedAt only if the original connection is still current. A stale/detached/closed connection receives registered=false and the gateway closes that connection. No credential appears in the receipt.

Client validates nonce, device ID, type, exact field set, safe positive generation and connectedAt. A changed generation/session within a single WebSocket closes that socket to use the agent's existing reconnect mechanism; a missing proof has a bounded deadline. The source feature flag EXECUTOR_REGISTRATION_PROBE_ENABLED=1 is OFF by default. Agent code does not change local service scheduling, restart a process, or grant execution permission.

## Explicit evidence boundaries
- A nonce echo on a correctly TLS-attested device WebSocket is not a signed portable health attestation, provider authorization, or task-head license.
- Gateway DeviceRegistry.getIfGeneration must still fence dispatch within the broker. Neither this flag nor a returned receipt authorizes model work, VeraOS installation, or protected effects.
- This is a source/test subject only. It does not prove Keeper installation, supervised restart under fault, post-reboot persistence, delegated chat identity, or selected VeraOS runtime consumption.
- A receiver-owned host acceptance test must verify installed binary hash and exact endpoint before any opt-in use. Do not enable this flag or deploy the gateway from this PR without separate operator authorization.

## Tests and negative controls
1. Source unit tests reject detached-but-still-OPEN sockets, replaced mappings, wrong IDs and nonces, malformed or extra fields, invalid generation and session metadata, and closed socket.
2. A disposable localhost gateway with test-only tokens must bind the positive receipt to bearer-protected /health, increment generation on replacement, and hide device state from unauthenticated /health.
3. The existing Executor test suite must remain passing without the feature flag.
4. L3 Training should test that a valid node receipt never substitutes for a model artifact digest, independent model competence, or node resource reservation.
5. L4 PORTAL should test that a checked-out 44-folder preview plus valid node receipt never substitutes for an assembled source manifest, bootable image, installed file hashes, boot lifecycle, selected runtime route and actual task consumption.

## Adversarial review required
PORTAL independently reviews stale generation and task-head race at dispatch; Training independently reviews self-declared model/node binding and workload/resource inference. Neither peer's approval is inferred from this document. No branch merge, production service change, task scheduler addition, paid model execution, or Plex disruption is authorized.
