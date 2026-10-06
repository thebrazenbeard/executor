# Direct Executor Device Ingress Implementation Plan

**Goal:** Replace relay-based device ingress with a $0 direct TLS path that has no third-party traffic quota.

### Task 1 — Custom CA support and Caddy bootstrap
- Add optional `EXECUTOR_DEVICE_CA_FILE` to the device agent WebSocket TLS options.
- Extend Windows enrollment/install/launcher to carry and store the public CA certificate separately from the device token.
- Add `Install-ExecutorCaddy.ps1` which downloads Caddy only from official GitHub releases and verifies the archive against the release SHA-512 checksum file.
- Focused tests cover CA propagation and installer provenance.

### Task 2 — Direct runtime
- Add `Start/Get/Stop/Restart-ExecutorDirect.ps1`.
- Start the existing headless control plane.
- Resolve/public-host parameterize the endpoint.
- Persist Caddy data/config under the Executor runtime root.
- Configure Caddy `tls internal` and reverse proxy only to loopback device ingress.
- Create firewall rule and attempt UPnP static TCP mapping.
- Persist only non-secret direct-runtime state.
- Never invoke a relay fallback.

### Task 3 — Reachability and operator surface
- Add `Test-ExecutorDirectReachability.ps1` for local TLS/certificate validation and explicit remote qualification inputs.
- Update enrollment to embed Caddy's public root CA.
- Replace Cloudflare quickstart docs/acceptance requirements with direct-ingress requirements.
- Remove Cloudflare runtime/parser/tests from the branch.
- Full exact-head Ubuntu/Windows CI, PowerShell parse, real Desktop Commander 8/64, audit.
