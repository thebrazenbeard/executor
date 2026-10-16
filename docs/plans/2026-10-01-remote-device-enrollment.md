# Remote Device Enrollment Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Executor operate as an always-on control plane independent of any specific workstation, with RDC-like Windows enrollment for arbitrary laptops.

**Architecture:** Keep OpenAI Secure MCP Tunnel attached only to the private MCP listener. Add a second, independently bound device-ingress listener that exposes only the authenticated `/device` WebSocket and a minimal health probe; operators TLS-front this listener for remote laptops. A headless control-plane runtime starts Executor plus `tunnel-client` with zero devices connected, while Windows enrollment installs the pinned payload, stores its device credential locally with DPAPI, and connects outbound to device ingress.

**Tech Stack:** TypeScript/Node.js 24, `ws`, PowerShell 5.1+, OpenAI `tunnel-client`, GitHub Actions on Ubuntu and Windows.

## Global Constraints

- Full workstation authority remains unchanged after a device is authorized.
- MCP ingress stays private/loopback-first and is reached from ChatGPT through Secure MCP Tunnel.
- Device ingress is a separate network surface and must not expose `/mcp`.
- The control plane must start and remain healthy with zero connected workstations.
- Default concurrency remains 8 execution lanes per device and 64 logic/upstream lanes.
- Windows device enrollment is one-command/bootstrap oriented and must not require the tunnel ID or tunnel API secret on the laptop.
- Per-device credentials are preferred; a configured credential file may be updated without restarting the control plane.
- Repository state, runtime state, docs, and tests must not persist real tunnel secrets or device bearer tokens.
- PR #1 remains draft and `main` is not merged.

---

### Task 1: Split private MCP ingress from remote device ingress

**Files:**
- Modify: `src/config.ts`
- Modify: `src/server.ts`
- Modify: `src/auth.ts`
- Modify: `src/test/device-auth-integration.test.ts`
- Create: `src/test/remote-device-ingress.test.ts`

**Interfaces:**
- Consumes: existing MCP HTTP handler, `DeviceRegistry`, `deviceTokenAuthorized`, `EXECUTOR_DEVICE_TOKEN(S)_JSON`.
- Produces: `EXECUTOR_DEVICE_HOST`, `EXECUTOR_DEVICE_PORT`, optional `EXECUTOR_DEVICE_TOKENS_FILE`; a device-only HTTP/WebSocket listener.

- [ ] **Step 1: Add the focused failing test**

Add integration coverage proving a device can attach on `EXECUTOR_DEVICE_PORT`, that the device listener returns 404 for `/mcp`, and that a configured token file can be changed so a new per-device token becomes usable without restarting the server.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm test`
Expected: non-zero because the current server binds `/device` to the MCP listener and rejects file-only device credentials.

- [ ] **Step 3: Implement the minimum behavior**

Add an independent device bind config with loopback-first defaults, attach the WebSocket server only to that listener, expose only a minimal device health route, and reload the optional credential JSON file at each hello. Environment-map entries override file entries; shared fallback behavior remains unchanged.

- [ ] **Step 4: Verify the focused pass**

Run: `npm test`
Expected: device-ingress and file-reload tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: GitHub Actions Ubuntu and Windows `npm test`.
Expected: both operating systems pass with no regression to existing MCP routing/auth tests.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat: split remote device ingress from MCP`

### Task 2: Add a headless control-plane runtime

**Files:**
- Create: `scripts/Start-ExecutorControlPlane.ps1`
- Create: `scripts/Stop-ExecutorControlPlane.ps1`
- Create: `scripts/Restart-ExecutorControlPlane.ps1`
- Create: `scripts/Get-ExecutorControlPlaneStatus.ps1`
- Create: `src/test/control-plane-runtime.test.ts`

**Interfaces:**
- Consumes: `EXECUTOR_CLIENT_TOKEN`, `EXECUTOR_TUNNEL_ID`, `EXECUTOR_TUNNEL_API_SECRET`, device credential configuration, built `dist/server.js`, tunnel profile.
- Produces: a persistent server+tunnel runtime with zero-device support and a secret-free `control-plane-state.json`.

- [ ] **Step 1: Add the focused failing test**

Assert the new operator scripts exist, start server+tunnel without any device-agent/install-root/manifest requirements, preserve 8/64 defaults, verify tunnel readiness/MCP session initialization, and keep secrets out of persisted state.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm test`
Expected: non-zero because the control-plane scripts do not yet exist.

- [ ] **Step 3: Implement the minimum behavior**

Create start/stop/restart/status scripts mirroring the current PID-fencing and `/readyz` checks while deliberately omitting local device launch. Default the dynamic token file under the runtime root when no shared/map credential is supplied.

- [ ] **Step 4: Verify the focused pass**

Run: `npm test`
Expected: control-plane operator contract passes.

- [ ] **Step 5: Run the affected integration check**

Run: Windows CI PowerShell parse step.
Expected: all checked-in PowerShell files parse successfully.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat: add headless Executor control plane`

### Task 3: Add RDC-like Windows laptop enrollment

**Files:**
- Create: `scripts/New-ExecutorDeviceEnrollment.ps1`
- Create: `scripts/Install-ExecutorDevice.ps1`
- Create: `scripts/Start-ExecutorInstalledDevice.ps1`
- Create: `src/test/device-enrollment.test.ts`
- Modify: `docs/SETUP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `test/acceptance-contract.json`

**Interfaces:**
- Consumes: public/TLS device-ingress base URL, device ID, server-side credential file, Git/Node/npm on the Windows laptop.
- Produces: a per-device token, bootstrap command, locally built Executor device agent, pinned Desktop Commander payload, DPAPI-protected device secret, current-user scheduled task, and outbound device connection.

- [ ] **Step 1: Add the focused failing test**

Assert enrollment/bootstrap scripts exist; generated credentials are cryptographically random; the server credential file is atomically updated; the laptop never receives tunnel credentials; local config excludes the raw device token; DPAPI protects the token; and startup launches `dist/device-agent.js`.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm test`
Expected: non-zero because enrollment scripts do not yet exist.

- [ ] **Step 3: Implement the minimum behavior**

Generate per-device credentials on the control-plane host, emit a copyable PowerShell bootstrap command, clone/build Executor on the target laptop, install the exact pinned Desktop Commander payload, protect the device token with Windows DPAPI, register a current-user logon task, and start the agent immediately.

- [ ] **Step 4: Verify the focused pass**

Run: `npm test`
Expected: enrollment contract tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: Windows PowerShell parse validation plus full CI.
Expected: all scripts parse and repository tests remain green.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat: add Windows Executor device enrollment`

## Unresolved externally observable decisions

None for this implementation slice. Windows is the first enrollment target because the requested operator experience is PowerShell-based; macOS/Linux enrollment can be added as separate installers without changing the control-plane protocol.
