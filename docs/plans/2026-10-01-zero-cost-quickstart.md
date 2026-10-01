# Zero-Cost Executor Quickstart Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a $0 one-command Windows quickstart that launches the existing Executor control plane plus a temporary public HTTPS/WSS device endpoint and can enroll/repoint arbitrary laptops.

**Architecture:** Reuse the existing headless control-plane runtime unchanged for ChatGPT MCP transport, add a Cloudflare Quick Tunnel only in front of the separate device listener, and persist a second secret-free lifecycle record for the Quick Tunnel wrapper. Device endpoint changes are handled by a small installed-device repoint command rather than reinstalling the agent.

**Tech Stack:** TypeScript/Node.js 24, PowerShell 5.1+, `cloudflared`, GitHub Actions Windows/Ubuntu.

## Global Constraints

- Recurring monetary cost must remain $0.
- No purchased domain, paid hosting, named Cloudflare Tunnel requirement, Cloudflare account requirement, Workers usage, or other metered fallback.
- Quick Tunnel exposes device ingress only; MCP remains private behind OpenAI Secure MCP Tunnel.
- Existing 8 execution / 64 logic semantics and full-authority Windows device behavior remain unchanged.
- Tunnel/API/device secrets are never persisted in runtime state or committed.
- The Synology SPK branch remains untouched.
- PR #1 stays draft and `main` remains untouched.

---

### Task 1: Quick Tunnel parsing and local cloudflared bootstrap

**Files:**
- Create: `src/quick-tunnel.ts`
- Create: `src/test/quick-tunnel.test.ts`
- Create: `scripts/Install-ExecutorCloudflared.ps1`
- Create: `src/test/zero-cost-quickstart.test.ts`

**Interfaces:**
- Consumes: cloudflared mixed stdout/stderr text and Windows architecture/signature metadata.
- Produces: `extractTryCloudflareUrl(log): string | undefined` and a validated local `cloudflared.exe` path.

- [ ] **Step 1: Add focused failing tests**

Test valid `https://*.trycloudflare.com` extraction; reject plaintext, unrelated hosts, embedded credentials, and malformed URL text. Assert installer downloads only Cloudflare's official release binary, validates Authenticode, and has no account/domain/named-tunnel flow.

- [ ] **Step 2: Verify relevant failure**

Run: `npm test`
Expected: non-zero because the parser/module and installer do not exist.

- [ ] **Step 3: Implement minimum behavior**

Implement strict URL extraction and local Windows bootstrap with x64/32-bit architecture selection, local-user install root, official release URL, Authenticode `Valid` requirement, and Cloudflare signer check.

- [ ] **Step 4: Verify focused pass**

Run: `npm test`
Expected: parser/installer contracts pass; later quickstart tests may remain red.

- [ ] **Step 5: Integration check**

Run full CI.
Expected: no regression to existing server/device tests.

- [ ] **Step 6: Commit**

Commit message: `feat: bootstrap zero-cost Cloudflare quick tunnel`

### Task 2: One-command zero-cost runtime

**Files:**
- Create: `scripts/Start-ExecutorZeroCost.ps1`
- Create: `scripts/Get-ExecutorZeroCostStatus.ps1`
- Create: `scripts/Stop-ExecutorZeroCost.ps1`
- Create: `scripts/Restart-ExecutorZeroCost.ps1`
- Modify: `src/test/zero-cost-quickstart.test.ts`

**Interfaces:**
- Consumes: existing `Start-ExecutorControlPlane.ps1`, optional OpenAI credential-file path, optional `DeviceId`, local device port 8788.
- Produces: verified temporary public HTTPS device URL, `zero-cost-state.json`, optional laptop bootstrap command.

- [ ] **Step 1: Add/update focused failing test**

Assert the four lifecycle scripts exist, no paid/account/named-tunnel command appears, credential-file parsing never persists secret values, PID identity fencing is present, public health is verified, and optional device enrollment receives the discovered public URL.

- [ ] **Step 2: Verify relevant failure**

Run: `npm test`
Expected: non-zero because lifecycle scripts do not exist.

- [ ] **Step 3: Implement minimum behavior**

Resolve credentials, generate ephemeral client bearer if needed, start control plane, start Quick Tunnel, parse/validate URL, probe public health, persist secret-free state, and optionally issue enrollment. Stop/status/restart validate recorded process identities and current public readiness.

- [ ] **Step 4: Verify focused pass**

Run: `npm test`
Expected: zero-cost lifecycle contract passes.

- [ ] **Step 5: Integration check**

Run Windows PowerShell parse and full CI.
Expected: all scripts parse; Windows real-payload 8/64 qualification remains green.

- [ ] **Step 6: Commit**

Commit message: `feat: add zero-cost Executor quickstart`

### Task 3: Endpoint repointing, exact source pinning, and operator docs

**Files:**
- Create: `scripts/Set-ExecutorInstalledDeviceEndpoint.ps1`
- Modify: `scripts/New-ExecutorDeviceEnrollment.ps1`
- Create: `src/test/installed-device-endpoint.test.ts`
- Modify: `README.md`
- Modify: `docs/SETUP.md`
- Modify: `test/acceptance-contract.json`
- Create: `docs/specs/2026-10-01-zero-cost-quickstart-design.md`

**Interfaces:**
- Consumes: installed `device.json`, current scheduled task, local Git HEAD.
- Produces: validated endpoint update/restart and commit-pinned bootstrap source ref by default.

- [ ] **Step 1: Add focused failing test**

Assert endpoint updates require HTTPS except loopback, preserve non-endpoint configuration, restart the existing task, and enrollment derives an exact 40-hex Git HEAD unless `-SourceRef` is supplied.

- [ ] **Step 2: Verify relevant failure**

Run: `npm test`
Expected: non-zero until the repoint/source-pin behavior exists.

- [ ] **Step 3: Implement minimum behavior**

Add endpoint update script and source-ref resolver; update docs with temporary-hostname/repoint workflow and explicit $0 evidence boundary.

- [ ] **Step 4: Verify focused pass**

Run: `npm test`
Expected: new contracts and all existing tests pass.

- [ ] **Step 5: Full verification**

Run PR CI on the exact branch head.
Expected: Ubuntu PASS, Windows PASS, PowerShell parse PASS, real-payload 8/64 PASS, audit 0 vulnerabilities.

- [ ] **Step 6: Commit**

Commit message: `feat: make zero-cost quickstart usable across tunnel restarts`

## Unresolved externally observable decisions

None for this testing/development quickstart. A stable production hostname remains a separate future deployment choice and must also satisfy the user's $0 recurring-cost constraint.
