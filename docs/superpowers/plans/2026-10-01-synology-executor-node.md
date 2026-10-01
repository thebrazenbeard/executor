# Synology Executor Node V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an `armada38x` Synology SPK that connects a DS216 to the existing Executor control plane as a first-class `synology-storage` device, gives ChatGPT full read/write access to explicitly granted storage roots, exposes broad read-only DSM state, and requires explicit user verification before any supported DSM mutation.

**Architecture:** Extend the existing Executor `/device` protocol backward-compatibly with device-profile metadata and device-advertised execution capacity, then add an isolated Go module under `nodes/synology`. The Go node implements MCP lifecycle/tools directly, connects outbound to Executor over the existing device-ingress WebSocket, uses descriptor-relative Linux filesystem operations for storage containment, and packages as a DSM 7.2.2+ lower-privilege SPK.

**Tech Stack:** Existing TypeScript/Node.js Executor control plane; Go static Linux/ARMv7 node; `github.com/gorilla/websocket` for the node's WebSocket transport; `golang.org/x/sys/unix` for descriptor-relative/no-follow filesystem operations; POSIX shell for SPK lifecycle/build scripts; DSM 7.2.2 WIZARD_UIFILES custom-render format; GitHub Actions on Ubuntu/Windows plus an Ubuntu ARMv7/SPK build job.

**Spec:** `docs/superpowers/specs/2026-10-01-synology-executor-node-design.md`

## Global Constraints

- Target device is Synology DS216 / `armada38x`, ARMv7, 512 MB RAM.
- DSM minimum is `7.2.2-72806`; the 7.2.2 minimum is required because the approved installer uses the DSM 7.2.2 WIZARD_UIFILES format.
- Synology binary build is `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0`.
- Package identity is `ExecutorNode`; `conf/privilege` defaults to `run-as: package`.
- Windows/Desktop Commander devices remain full-authority workstation devices and remain backward compatible when they omit Synology profile metadata.
- Executor control-plane defaults remain 8 parallel execution lanes per Windows device and 64 parallel logic lanes.
- DS216 advertises `executionCapacity: 2`; the server uses `min(control-plane ceiling, advertised device capacity)`.
- Full storage authority means full content read/write/delete/copy/move authority only inside configured roots the DSM package account can actually access.
- Caller paths are root-relative; absolute paths, `..`, symlink traversal, and DSM internal top-level names beginning with `@` are rejected.
- V1 storage tools do not expose `chmod`, `chown`, ACL mutation, or DSM share-permission mutation.
- Broad DSM state may be read where supported; DSM mutations require prepare -> explicit user verification -> apply -> currentness/readback verification.
- V1 has no arbitrary shell, arbitrary root execution, raw block-device writes, or undocumented DSM database writes.
- Secrets are stored separately from non-secret configuration and never emitted by status, logs, package artifacts, or build output.
- Physical DS216 installation is a separate evidence class; CI cannot claim the SPK installed or ran on the NAS.

## File Structure

Control-plane additions:

- Create `src/device-profile.ts` — parse/validate optional device profile metadata and advertised capacity.
- Modify `src/protocol.ts` — add `DeviceProfile` and typed ready metadata.
- Modify `src/device-registry.ts` — retain device profile and effective capacity.
- Modify `src/server.ts` — validate hello metadata, clamp capacity, return profile in `list_devices` and authenticated health.
- Create `src/test/synology-device-profile.test.ts` — backward compatibility and 2-lane scheduling tests.

Synology Go module:

- Create `nodes/synology/go.mod`, `go.sum`.
- Create `nodes/synology/cmd/executor-node/main.go` — process entrypoint.
- Create `nodes/synology/internal/config/config.go` — package-home config and separate token loading.
- Create `nodes/synology/internal/protocol/wire.go` — Executor wire messages and MCP JSON-RPC types.
- Create `nodes/synology/internal/bridge/client.go` — outbound WebSocket/reconnect/generation handling.
- Create `nodes/synology/internal/node/handler.go` — MCP lifecycle and tool dispatch.
- Create `nodes/synology/internal/storage/root_linux.go` — rooted descriptor-relative path handling.
- Create `nodes/synology/internal/storage/basic.go` — list/stat/read/write/append/mkdir/delete/list-roots.
- Create `nodes/synology/internal/storage/advanced.go` — copy/move/hash/search/space.
- Create `nodes/synology/internal/admin/read.go` — DSM read-only adapters.
- Create `nodes/synology/internal/change/engine.go` — immutable verified-change proposal store.
- Create `nodes/synology/internal/admin/mutate.go` — V1 typed self-management mutation adapters.
- Create corresponding focused `*_test.go` files alongside each unit.

SPK/build additions:

- Create `nodes/synology/synology/INFO`.
- Create `nodes/synology/synology/conf/privilege`, `conf/resource`.
- Create required lifecycle scripts under `nodes/synology/synology/scripts/`.
- Create DSM 7.2.2 wizard source under `nodes/synology/synology/WIZARD_UIFILES-src/` and generated `WIZARD_UIFILES/install_uifile`.
- Create `nodes/synology/synology/PACKAGE_ICON.PNG` and `PACKAGE_ICON_256.PNG`.
- Create `nodes/synology/build-spk.sh` and `nodes/synology/validate-spk.sh`.
- Create `nodes/synology/README.md`.
- Modify `.github/workflows/ci.yml`.
- Modify `README.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `skills/executor/SKILL.md`, and `test/acceptance-contract.json`.

## Review Focus

1. **Symlink/rename races inside writable shares:** a path validated as safe must not be replaceable with a symlink before mutation; Task 3 tests component-by-component no-follow descriptor walking and swap attempts.
2. **Large files on a 512 MB NAS:** reads, append writes, copy, hash, and content search must use bounded buffers; Tasks 4-5 test multi-hundred-MB sparse files while asserting request buffers stay bounded.
3. **Reconnect during a prepared DSM mutation:** a proposal prepared on one connection generation must not apply after reconnect; Task 7 explicitly rotates generation and expects rejection.
4. **Configured root lacks actual DSM permission:** the node must report `read-only` or `unavailable`, not claim full access or fail startup; Task 3 tests permission-probe outcomes independently per root.
5. **Upgrade/uninstall loses secrets or user data:** package upgrade must preserve config/token, and uninstall must remove package-owned runtime state without deleting share data; Task 8 tests lifecycle scripts against a fake DSM FHS tree.

---

### Task 1: Extend Executor device profiles and per-device capacity

**Files:**
- Create: `src/device-profile.ts`
- Modify: `src/protocol.ts`
- Modify: `src/device-registry.ts`
- Modify: `src/server.ts`
- Create: `src/test/synology-device-profile.test.ts`
- Modify: `src/test/device-registry.test.ts`
- Modify: `src/test/mcp-integration.test.ts`

**Interfaces:**
- Produces:
  - `DeviceProfile = { kind: string; platform?: string; arch?: string; packageArch?: string; nodeVersion?: string; executionCapacity?: number }`
  - `parseDeviceProfile(value: unknown): DeviceProfile | undefined`
  - `effectiveDeviceCapacity(controlPlaneCeiling: number, profile?: DeviceProfile): number`
  - `DeviceHello.deviceProfile?: DeviceProfile`
  - ready frame `{ type: "ready"; deviceId: string; generation: number }`
  - `DeviceAttachment.deviceProfile?: DeviceProfile`
- Consumes: existing device hello/authentication flow and `DeviceRegistry`.

- [ ] **Step 1: Write the failing profile/capacity tests**

Add tests asserting:
- a legacy Windows hello without `deviceProfile` gets capacity 8;
- `{kind:"synology-storage", platform:"linux", arch:"armv7", packageArch:"armada38x", nodeVersion:"0.1.0", executionCapacity:2}` gets capacity 2;
- an advertised capacity above 8 clamps to 8;
- zero, negative, non-integer, or non-numeric capacity is rejected from the hello;
- `list_devices` and authenticated `/health` return the stored profile;
- the ready frame includes the current device generation.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test`
Expected: FAIL because profile metadata/generation-ready behavior does not exist.

- [ ] **Step 3: Implement profile validation and effective-capacity calculation**

Implement the exact interfaces above in `src/device-profile.ts`; keep unknown optional string fields bounded to 128 characters and `executionCapacity` to positive integers.

- [ ] **Step 4: Thread metadata through registry/server**

Construct `DeviceConnection` with `effectiveDeviceCapacity(...)`, store the profile, expose it from `describe()`, and include current generation in the ready message.

- [ ] **Step 5: Run TypeScript tests**

Run: `npm test`
Expected: PASS, including all existing Windows/remote-enrollment tests.

- [ ] **Step 6: Commit**

Commit: `feat: add Executor device profiles and capacity negotiation`

### Task 2: Build the Go node bridge and MCP lifecycle

**Files:**
- Create: `nodes/synology/go.mod`
- Create: `nodes/synology/cmd/executor-node/main.go`
- Create: `nodes/synology/internal/config/config.go`
- Create: `nodes/synology/internal/config/config_test.go`
- Create: `nodes/synology/internal/protocol/wire.go`
- Create: `nodes/synology/internal/bridge/client.go`
- Create: `nodes/synology/internal/bridge/client_test.go`
- Create: `nodes/synology/internal/node/handler.go`
- Create: `nodes/synology/internal/node/handler_test.go`

**Interfaces:**
- `config.Load(path string) (Config, error)`
- `config.LoadToken(path string) (string, error)`
- `bridge.Client.Run(ctx context.Context, handler node.Handler) error`
- `node.Handler.Initialize(ctx context.Context, params json.RawMessage) (protocol.JsonRPC, error)`
- `node.Handler.ListTools(ctx context.Context) ([]protocol.Tool, error)`
- `node.Handler.CallTool(ctx context.Context, name string, args json.RawMessage) (protocol.ToolResult, error)`
- Hello profile is fixed to `kind=synology-storage`, `platform=linux`, `arch=armv7`, `packageArch=armada38x`, `executionCapacity=2`.

- [ ] **Step 1: Write config tests**

Assert config rejects missing HTTPS Executor URL, blank device ID, a token file that is group/world-readable, duplicate root IDs, and a configured root equal to `/volume1`; token contents never appear in formatted config/status output.

- [ ] **Step 2: Write bridge tests**

Use an in-process WebSocket test server to assert:
- hello contains the exact Synology profile;
- ready generation is retained by the client;
- `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call` round-trip correctly;
- disconnect causes bounded exponential reconnect without replaying an in-flight mutating request.

- [ ] **Step 3: Confirm red**

Run: `cd nodes/synology && go test ./...`
Expected: FAIL because the Go module/node does not exist.

- [ ] **Step 4: Implement config/protocol/bridge/handler skeleton**

Use `github.com/gorilla/websocket` as the WebSocket dependency. Keep the bridge ignorant of storage/admin internals; it only invokes the `node.Handler` interface.

- [ ] **Step 5: Verify Go module**

Run: `cd nodes/synology && go test ./...`
Expected: PASS.

- [ ] **Step 6: Cross-compile the skeleton**

Run: `cd nodes/synology && env GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -o build/executor-node ./cmd/executor-node`
Expected: exit 0.

- [ ] **Step 7: Commit**

Commit: `feat: add Synology Executor node bridge`

### Task 3: Implement rooted storage containment

**Files:**
- Create: `nodes/synology/internal/storage/types.go`
- Create: `nodes/synology/internal/storage/root_linux.go`
- Create: `nodes/synology/internal/storage/root_linux_test.go`

**Interfaces:**
- `storage.NewManager(config []RootConfig) (*Manager, error)`
- `(*Manager).Roots() []RootStatus`
- `(*Manager).OpenRead(rootID, rel string) (*os.File, error)`
- `(*Manager).OpenParent(rootID, rel string) (ParentHandle, string, error)`
- `ParentHandle.Close() error`
- `RootStatus.Access` is exactly one of `writable`, `read-only`, `unavailable`.

- [ ] **Step 1: Write hostile containment tests**

Test absolute path, empty/root-only mutation, `..`, nested symlink escape, final-component symlink mutation, `@appstore`/other top-level `@` names, duplicate root IDs, and a reproducible component-swap attempt between validation and open.

- [ ] **Step 2: Write permission-state tests**

With temporary roots, assert independent `writable`, `read-only`, and `unavailable` reporting; one bad root must not prevent other roots from loading.

- [ ] **Step 3: Confirm red**

Run: `cd nodes/synology && go test ./internal/storage -run 'Root|Containment|Permission' -v`
Expected: FAIL.

- [ ] **Step 4: Implement descriptor-relative traversal**

Use `golang.org/x/sys/unix`; open the configured root once, then walk components with `openat` + `O_NOFOLLOW` and directory file descriptors. Mutations operate relative to the validated parent descriptor rather than converting back to an absolute path.

- [ ] **Step 5: Verify containment**

Run: `cd nodes/synology && go test ./internal/storage -run 'Root|Containment|Permission' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: enforce rooted Synology storage access`

### Task 4: Implement basic storage MCP tools

**Files:**
- Create: `nodes/synology/internal/storage/basic.go`
- Create: `nodes/synology/internal/storage/basic_test.go`
- Create: `nodes/synology/internal/node/storage_tools.go`
- Modify: `nodes/synology/internal/node/handler.go`
- Modify: `nodes/synology/internal/node/handler_test.go`

**Interfaces:**
- Tools: `storage.list_roots`, `storage.list`, `storage.stat`, `storage.read`, `storage.write`, `storage.append`, `storage.mkdir`, `storage.delete`.
- `storage.read` accepts `rootId,path,offset?,length?,encoding?`; `length` is capped at 524288 bytes per call.
- `storage.write` replaces a file atomically for payloads up to 524288 bytes using a same-directory temp file -> flush/sync -> rename.
- `storage.append` accepts at most 524288 bytes per call and is explicitly reported as non-atomic.
- Data encoding is `utf8` or `base64`.

- [ ] **Step 1: Write tool-schema and behavior tests**

Pin exact tool names and required arguments; verify list/stat/read, atomic replacement, append, mkdir, recursive/non-recursive delete behavior, read-only-root rejection, and no symlink following.

- [ ] **Step 2: Add bounded-memory tests**

Create a sparse large file and assert `storage.read` never returns more than 524288 source bytes in one call; exercise repeated append chunks to produce a file larger than available request memory.

- [ ] **Step 3: Confirm red**

Run: `cd nodes/synology && go test ./internal/storage ./internal/node -run 'Basic|Tool|Read|Write|Append' -v`
Expected: FAIL.

- [ ] **Step 4: Implement minimal storage operations**

Keep filesystem logic in `internal/storage`; `internal/node/storage_tools.go` only validates MCP arguments and maps results/errors.

- [ ] **Step 5: Verify**

Run: `cd nodes/synology && go test ./internal/storage ./internal/node -v`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add Synology storage read write tools`

### Task 5: Implement advanced storage operations

**Files:**
- Create: `nodes/synology/internal/storage/advanced.go`
- Create: `nodes/synology/internal/storage/advanced_test.go`
- Modify: `nodes/synology/internal/node/storage_tools.go`

**Interfaces:**
- Tools: `storage.copy`, `storage.move`, `storage.hash`, `storage.search`, `storage.space`.
- Same-root move uses descriptor-relative rename and returns `atomic:true`.
- Cross-root move streams copy, verifies destination size, flushes, then deletes source and returns `atomic:false`.
- Hash algorithm in V1 is `sha256`.
- Search supports `kind=name|content`, literal query only, default 100 results, hard maximum 1000; content search skips individual files larger than 16 MiB unless caller explicitly supplies a smaller path scope.

- [ ] **Step 1: Write advanced-operation tests**

Cover same-root and cross-root copy/move, collision behavior, interrupted-copy cleanup, SHA-256, free-space reporting, literal name search, bounded content search, and symlink exclusion during recursion.

- [ ] **Step 2: Add low-memory test**

Copy/hash/search a large sparse file using a fixed <=1 MiB internal buffer and assert no code path reads the entire file into a byte slice.

- [ ] **Step 3: Confirm red**

Run: `cd nodes/synology && go test ./internal/storage -run 'Copy|Move|Hash|Search|Space' -v`
Expected: FAIL.

- [ ] **Step 4: Implement streaming operations**

Use bounded reusable buffers and the rooted descriptor layer from Task 3.

- [ ] **Step 5: Verify**

Run: `cd nodes/synology && go test ./internal/storage ./internal/node -v`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add advanced Synology storage operations`

### Task 6: Add broad read-only DSM inspection

**Files:**
- Create: `nodes/synology/internal/admin/types.go`
- Create: `nodes/synology/internal/admin/read.go`
- Create: `nodes/synology/internal/admin/read_test.go`
- Create: `nodes/synology/internal/node/admin_tools.go`
- Modify: `nodes/synology/internal/node/handler.go`

**Interfaces:**
- Read-only tools implemented in V1:
  - `admin.system_info`
  - `admin.storage_info`
  - `admin.network_info`
  - `admin.package_status`
  - `admin.user_group_info`
  - `admin.shared_folder_info`
  - `admin.update_info`
  - `admin.executor_status`
- Reads use standard Linux/DSM files and directories that are readable as the package user; they do not invoke sudo/root helpers.
- User/group output excludes password hashes and authentication secrets.
- Package status is derived from readable `/var/packages/*/INFO`/package metadata, not package mutation commands.

- [ ] **Step 1: Write fixture-driven DSM read tests**

Create fixture trees for `/etc/VERSION`, `/proc`, package metadata, passwd/group, mounted volumes, and shared-folder roots. Assert normalized typed results and graceful `unsupported`/permission-denied fields instead of node failure.

- [ ] **Step 2: Write secret-redaction tests**

Fixture keys/names containing password, secret, token, credential, private-key material must not appear in admin output.

- [ ] **Step 3: Confirm red**

Run: `cd nodes/synology && go test ./internal/admin ./internal/node -run 'Admin|System|Package|User|Shared|Update' -v`
Expected: FAIL.

- [ ] **Step 4: Implement read adapters**

Inject filesystem roots/readers in tests; production uses real DSM paths. Do not add generic arbitrary-file DSM reads.

- [ ] **Step 5: Verify**

Run: `cd nodes/synology && go test ./internal/admin ./internal/node -v`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add read only DSM inspection tools`

### Task 7: Add verified DSM mutation engine

**Files:**
- Create: `nodes/synology/internal/change/types.go`
- Create: `nodes/synology/internal/change/engine.go`
- Create: `nodes/synology/internal/change/engine_test.go`
- Create: `nodes/synology/internal/admin/mutate.go`
- Create: `nodes/synology/internal/admin/mutate_test.go`
- Modify: `nodes/synology/internal/node/admin_tools.go`
- Modify: `nodes/synology/internal/bridge/client.go`
- Modify: `skills/executor/SKILL.md`

**Interfaces:**
- MCP tools:
  - `admin.prepare_change`
  - `admin.apply_change`
- `change.Proposal` contains `changeId,target,current,proposed,sideEffects,recovery,expiresAt,generation,parametersHash`.
- Proposal TTL is 5 minutes.
- `Engine.Prepare(ctx, generation, adapter, args) (Proposal, error)`
- `Engine.Apply(ctx, generation, changeID) (ApplyResult, error)`
- V1 mutation adapters: `executor.reconnect` and `executor.restart`.
- Adapter interface:
  - `ReadCurrent(ctx, args) (State, error)`
  - `Describe(current, args) (ProposalDescription, error)`
  - `Apply(ctx, args) error`
  - `ReadBack(ctx, args) (State, error)`.

- [ ] **Step 1: Write proposal-integrity tests**

Assert one-time use, 5-minute expiration, immutable normalized parameters, current-state hash/currentness check, generation binding, concurrent double-apply rejection, and readback verification.

- [ ] **Step 2: Write reconnect-generation test**

Prepare at generation N, simulate WebSocket reconnect/ready generation N+1, then assert apply rejects with `STALE_PROPOSAL`.

- [ ] **Step 3: Write skill-contract test**

Update the Executor skill contract so ChatGPT must present the exact proposal and obtain explicit user approval before calling `admin.apply_change`; add a repository test asserting that wording remains present.

- [ ] **Step 4: Confirm red**

Run: `cd nodes/synology && go test ./internal/change ./internal/admin ./internal/node -run 'Proposal|Apply|Generation|Restart|Reconnect' -v && cd ../.. && npm test`
Expected: FAIL.

- [ ] **Step 5: Implement engine and self-management adapters**

The restart adapter launches only the current verified ExecutorNode executable/configuration as the same package user, confirms child startup, then exits. No `sudo`, `synopkg`, or root helper.

- [ ] **Step 6: Verify**

Run: `cd nodes/synology && go test ./... && cd ../.. && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit: `feat: require verified proposals for DSM mutations`

### Task 8: Build DSM 7.2.2 SPK packaging and installer

**Files:**
- Create: `nodes/synology/synology/INFO`
- Create: `nodes/synology/synology/conf/privilege`
- Create: `nodes/synology/synology/conf/resource`
- Create: all required files under `nodes/synology/synology/scripts/`
- Create: `nodes/synology/synology/WIZARD_UIFILES-src/package.json`
- Create: `nodes/synology/synology/WIZARD_UIFILES-src/webpack.config.js`
- Create: `nodes/synology/synology/WIZARD_UIFILES-src/src/install-entry.js`
- Create: `nodes/synology/synology/WIZARD_UIFILES-src/src/install-settings.vue`
- Create generated: `nodes/synology/synology/WIZARD_UIFILES/install_uifile`
- Create: `nodes/synology/synology/PACKAGE_ICON.PNG`
- Create: `nodes/synology/synology/PACKAGE_ICON_256.PNG`
- Create: `nodes/synology/synology/LICENSE`
- Create: `nodes/synology/build-spk.sh`
- Create: `nodes/synology/validate-spk.sh`
- Create: `nodes/synology/tests/spk_test.sh`

**Interfaces / pinned package metadata:**
- `package="ExecutorNode"`
- `version="0.1.0-0001"`
- `arch="armada38x"`
- `os_min_ver="7.2.2-72806"`
- `maintainer="thebrazenbeard"`
- `description="Executor Synology storage node"`
- `conf/privilege` defaults to `run-as: package`.
- Persistent non-secret config uses `$SYNOPKG_PKGVAR/config.json`; token uses `$SYNOPKG_PKGHOME/device.token` mode 0600; executable lives under `$SYNOPKG_PKGDEST/bin/executor-node`.
- Installer wizard keys: `wizard_executor_url`, `wizard_device_id`, `wizard_device_token`, `wizard_share_roots`.

- [ ] **Step 1: Write SPK structure tests**

Assert required case-sensitive SPK members, exact INFO fields, icon dimensions 64x64 and 256x256, `run-as: package`, executable permission, and absence of secrets/sample real credentials.

- [ ] **Step 2: Write lifecycle tests against a fake FHS tree**

Exercise postinst/start/status/stop/preupgrade/postupgrade/uninstall behavior with fake `SYNOPKG_PKGDEST`, `SYNOPKG_PKGVAR`, `SYNOPKG_PKGHOME`, and `SYNOPKG_PKGTMP`. Assert:
- wizard values become config/token files;
- token mode is 0600;
- upgrade preserves config/token;
- uninstall removes package-owned runtime files but never deletes configured share-root data;
- status uses documented DSM exit codes.

- [ ] **Step 3: Confirm red**

Run: `bash nodes/synology/tests/spk_test.sh`
Expected: FAIL.

- [ ] **Step 4: Implement WIZARD_UIFILES source**

Follow Synology's DSM 7.2.2 custom-render contract; use the documented Vue 2.7.14 / vue-loader 15.10.1 generation approach and return the four exact wizard keys above. Password/token input must render as a password field and must never be echoed by lifecycle scripts.

- [ ] **Step 5: Implement package metadata/lifecycle scripts**

Use Synology FHS variables rather than hard-coded package paths. Do not use root-run lifecycle actions.

- [ ] **Step 6: Implement SPK assembly/validation**

`build-spk.sh` cross-compiles the Go binary, builds `package.tgz`, then assembles `ExecutorNode-armada38x-0.1.0-0001.spk`. `validate-spk.sh` expands both archive layers and checks metadata, ELF architecture, no dynamic-library requirement, file modes, and secret patterns.

- [ ] **Step 7: Verify locally in CI-compatible environment**

Run:
`cd nodes/synology && env GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -o build/executor-node ./cmd/executor-node && cd ../.. && bash nodes/synology/build-spk.sh && bash nodes/synology/validate-spk.sh`
Expected: PASS and one SPK artifact.

- [ ] **Step 8: Commit**

Commit: `feat: package ExecutorNode for Synology armada38x`

### Task 9: Integrate CI, documentation, and acceptance contract

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `nodes/synology/README.md`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SETUP.md`
- Modify: `SECURITY.md`
- Modify: `test/acceptance-contract.json`
- Create: `src/test/synology-package-contract.test.ts`

**Interfaces:**
- New CI job `synology-node` on Ubuntu.
- Artifact name: `ExecutorNode-armada38x-0.1.0-0001.spk`.
- Acceptance IDs continue after the current highest ID; do not renumber existing Executor V1 requirements.

- [ ] **Step 1: Add package-contract tests**

Assert documentation states:
- package user needs Read/Write permission on desired DSM shared folders;
- Windows devices retain 8 lanes;
- DS216 advertises 2;
- 64 logic lanes remain control-plane capacity;
- DSM reads are broad but supported mutations require explicit verified proposals;
- physical NAS install is not implied by CI.

- [ ] **Step 2: Extend GitHub Actions**

Add a Linux job that installs Go, runs `go test ./...`, cross-compiles ARMv7, runs SPK tests/build/validation, executes `file`/ELF inspection on the binary, and uploads only the completed SPK as an Actions artifact.

- [ ] **Step 3: Run full repository verification**

Run:
- `npm test`
- `npm run audit`
- `cd nodes/synology && go test ./...`
- `bash nodes/synology/build-spk.sh`
- `bash nodes/synology/validate-spk.sh`

Expected: all PASS.

- [ ] **Step 4: Verify exact-head GitHub Actions**

Require Ubuntu + Windows existing Executor jobs and the new `synology-node` job to pass on the same commit. Record the exact head and artifact name in the stacked PR body.

- [ ] **Step 5: Hostile final review**

Challenge at minimum:
- root/symlink escape;
- accidental DSM-secret disclosure;
- mutation approval bypass;
- capacity negotiation regression;
- SPK lifecycle data loss;
- ARMv7/runtime-memory assumptions.

Record surviving claims and unresolved physical-NAS evidence separately.

- [ ] **Step 6: Commit**

Commit: `test: qualify Synology Executor node package`

### Task 10: Prepare physical DS216 qualification without claiming it

**Files:**
- Create: `nodes/synology/QUALIFICATION.md`

**Interfaces:**
- Consumes the CI-built `ExecutorNode-armada38x-0.1.0-0001.spk`.
- Produces a human-run checklist and evidence format; it does not alter CI claims.

- [ ] **Step 1: Write the DS216 install/qualification checklist**

Include:
1. install the SPK manually in Package Center;
2. grant the `ExecutorNode` system-internal package user Read/Write on chosen shares;
3. confirm package status is running;
4. confirm Executor `list_devices` reports `kind=synology-storage`, `packageArch=armada38x`, capacity 2;
5. create/read/hash/move/delete a disposable test tree in a granted share;
6. attempt `../`, absolute path, symlink escape, and `@appstore` access and require rejection;
7. inspect DSM read-only tools;
8. prepare an ExecutorNode restart, confirm no apply occurs before user approval, approve it, and verify readback/reconnect;
9. record idle RSS and ensure it is below the 32 MB design target;
10. leave all real user data untouched.

- [ ] **Step 2: Add an evidence template**

Fields: NAS model, DSM version, package version/hash, Executor server exact head, device generation, granted roots, test results, RSS, failures, reviewer, date.

- [ ] **Step 3: Verify no CI or README claim marks physical qualification complete**

Search: `git grep -n "DS216.*PASS\|physically qualified\|installed successfully" -- . ':!nodes/synology/QUALIFICATION.md'`
Expected: no unsupported completion claim.

- [ ] **Step 4: Commit**

Commit: `docs: add DS216 physical qualification procedure`
