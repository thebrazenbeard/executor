# Executor Synology Node V1 Design

Date: 2026-10-01
Status: Approved design, implementation not started
Stacking base: `thebrazenbeard/executor@bf96c0a91a1f6a2cedd79feb7098add1d26d26cf`
Target device: Synology DS216, DSM 7.2.x+, package architecture `armada38x`

## Intent

Add a first-class Synology NAS device profile to Executor whose primary and strict purpose is to give an authorized ChatGPT/Executor session direct read/write access to storage on the DiskStation where the SPK is installed.

The node is a storage endpoint first, but it may expose broad read access to DSM state and configuration for diagnosis, inspection, and management planning. DSM mutations are allowed only through an explicit user-verification gate. The node is not an unrestricted root shell or an unreviewed general-purpose DSM mutation surface.

A DS216 connects to the same Executor control plane as Windows workstation devices while exposing a NAS-native storage tool surface.

The Synology node is not Desktop Commander transplanted onto DSM. It is a small native agent built for ARMv7/512 MB hardware that speaks Executor's existing `/device` protocol directly.

Success means:

- the SPK installs manually through DSM Package Center;
- the package runs under DSM 7's lower-privilege package identity rather than root;
- the node connects outbound to Executor with a per-device credential;
- Executor lists the device distinctly as a Synology/storage node;
- the node provides full read/write operations within every explicitly granted shared-folder root;
- the node exposes a limited, enumerated NAS administration surface;
- there is no generic shell, arbitrary root execution, DSM account mutation, or unrestricted package-management authority in V1;
- the `armada38x` SPK is built and structurally validated in CI, not compiled on the NAS.

## Platform constraints

The DS216 uses a Marvell Armada 385 88F6820, ARMv7, Synology package architecture `armada38x`, with 512 MB RAM. The V1 binary therefore SHALL be a small statically linked Go executable built with `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0`.

DSM 7 requires packages to declare `conf/privilege` and strongly prefers `run-as: package`. Root packages require Synology-specific authorization and are intentionally outside V1.

The SPK SHALL target DSM 7.2 or newer with `os_min_ver="7.2-64570"`. The design is compatible with DSM 7.2.2-72806 and does not depend on a particular nano-update number.

Authoritative references:

- https://kb.synology.com/en-ca/DSM/tutorial/What_kind_of_CPU_does_my_NAS_have
- https://help.synology.com/developer-guide/
- https://help.synology.com/developer-guide/privilege/preface.html
- https://help.synology.com/developer-guide/privilege/privilege_config.html
- https://help.synology.com/developer-guide/resource_acquisition/data_share.html
- https://help.synology.com/developer-guide/synology_package/introduction.html
- https://help.synology.com/developer-guide/synology_package/wizard/WIZARD_UIFILES_v2.html
- https://help.synology.com/developer-guide/getting_started/system_requirement.html

## Repository layout

The Synology implementation stays in the Executor monorepo:

```text
executor/
  src/                         existing control plane
  nodes/
    synology/
      cmd/executor-node/       Go entrypoint
      internal/
        bridge/                Executor /device protocol adapter
        storage/               share-rooted filesystem operations
        admin/                 limited NAS information/self-management
        config/                local package configuration
        identity/              node metadata and device profile
      synology/
        INFO
        conf/
          privilege
          resource
        scripts/
          postinst
          postuninst
          postupgrade
          preinst
          preuninst
          preupgrade
          start-stop-status
        WIZARD_UIFILES/
          install_uifile
        LICENSE
        PACKAGE_ICON.PNG
        PACKAGE_ICON_256.PNG
      tests/
      build-spk.sh
      go.mod
      README.md
```

The control-plane implementation remains in its existing TypeScript package. The NAS node is an independently buildable Go module within the same repository.

## Device protocol extension

Executor V1 currently treats every device as a generic downstream MCP endpoint. That remains true, but the hello frame SHALL gain optional descriptive metadata:

```json
{
  "type": "hello",
  "deviceId": "DS216",
  "token": "...",
  "deviceProfile": {
    "kind": "synology-storage",
    "platform": "linux",
    "arch": "armv7",
    "packageArch": "armada38x",
    "nodeVersion": "0.1.0",
    "executionCapacity": 2
  },
  "initializeResult": { "...": "..." }
}
```

The fields are descriptive, not authorization claims. The server stores and returns this metadata from `list_devices` and `/health`. Authorization continues to depend on the mapped device credential and connection generation.

Existing Windows devices that omit `deviceProfile` continue to work unchanged and are reported as the legacy/default workstation profile.

## Node runtime

The Go process connects outbound to `wss://<executor>/device`, sends the normal hello frame, responds to JSON-RPC requests, reconnects with bounded exponential backoff, and exits non-zero if its static configuration is malformed.

The node implements the MCP lifecycle directly:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

It does not launch Node.js or Desktop Commander.

The node process SHALL have a conservative memory target: under 32 MB steady-state RSS during idle operation and no operation may require buffering an entire large file in memory.

## Storage authority model

"Full storage read/write" means full filesystem authority inside each share root explicitly granted to the DSM package user. It does not mean raw access to every path on the NAS.

The package runs as its DSM package account. The operator grants that account Read/Write permission on desired shared folders under:

Control Panel -> Shared Folder -> Edit -> Permission -> System internal user.

The node discovers usable roots from a local configuration generated after installation. A root is eligible only when:

1. it is an absolute path under a DSM data volume such as `/volume1/<share>`;
2. its top-level share name does not begin with `@`;
3. the package account can open the root for the requested access;
4. the root is not the package target/home directory, DSM system storage, or another explicitly excluded internal path.

V1 SHALL never recursively treat `/volume1` itself as an allowed root.

### Storage tools

V1 SHALL expose these logical tools:

- `storage.list`
- `storage.stat`
- `storage.read`
- `storage.write`
- `storage.append`
- `storage.mkdir`
- `storage.copy`
- `storage.move`
- `storage.delete`
- `storage.hash`
- `storage.search`
- `storage.space`
- `storage.list_roots`

Large reads/writes use bounded chunks/streaming. The default maximum response payload is constrained well below Executor's transport payload ceiling. Whole-file replacement uses a same-root temporary file followed by flush/sync and rename where the filesystem permits it; `storage.append` is the explicit non-atomic append operation.

"Full R/W" refers to file/directory content operations. V1 does not expose `chmod`, `chown`, ACL editing, or DSM share-permission mutation because those cross into administrative authority.

### Path containment

Path safety is a hard requirement because this node has destructive write authority.

The storage implementation SHALL:

- accept only root-relative paths from the MCP caller;
- reject absolute caller paths;
- reject `..` traversal;
- never follow symlinks during recursive traversal;
- reject final-component symlinks for mutation operations;
- use Linux file-descriptor-relative operations (`openat`/equivalent with `O_NOFOLLOW`) for mutations so a path cannot be swapped to escape the granted root between validation and use;
- reject any path component that escapes the configured root;
- reject DSM internal top-level names beginning with `@` even if accidentally visible;
- preserve normal files and directories without attempting to reinterpret DSM metadata directories.

A symlink may be reported by `storage.stat`, but V1 does not follow it for read/write/copy/move/delete traversal.

## DSM administration authority

The node may expose broad read-only DSM visibility, including configuration and operational state that the package account or a DSM-supported API can legitimately read. Read access is not confirmation-gated because it does not change the NAS.

Representative read tools may include:

- `admin.system_info`
- `admin.storage_info`
- `admin.network_info`
- `admin.package_status`
- `admin.service_status`
- `admin.user_group_info`
- `admin.shared_folder_info`
- `admin.security_info`
- `admin.update_info`
- `admin.executor_status`

V1 does not expose an unrestricted shell as the DSM administration interface.

### Verified DSM mutations

Any operation that alters DSM state MUST use a two-phase verified-change flow:

1. **Prepare** — ExecutorNode resolves the requested change, reads the current state, validates prerequisites, and returns an immutable proposal containing:
   - the exact target;
   - current value/state;
   - proposed value/state;
   - expected side effects;
   - rollback/recovery information when available;
   - a one-time `changeId`;
   - an expiration timestamp.
2. **User verification** — ChatGPT presents that exact proposal to the user and asks for explicit approval.
3. **Apply** — only after explicit approval, ChatGPT may submit `changeId` to the apply tool.
4. **Currentness check** — before mutation, ExecutorNode re-reads the target. If current state no longer matches the prepared proposal, the change expires and MUST be prepared again.
5. **Readback verification** — after mutation, ExecutorNode reads the resulting state and returns the observed result.

A prepared proposal is single-use, short-lived, bound to the exact node/device generation and exact normalized mutation parameters, and cannot be broadened during apply.

Examples of confirmation-gated DSM mutations may include:

- package/service start, stop, restart, enable, or disable;
- selected DSM configuration changes;
- shared-folder settings;
- user/group configuration;
- network settings;
- security settings;
- update settings;
- reboot/shutdown;
- ExecutorNode self-management.

Not every DSM setting is automatically supported merely because it exists. Each mutating capability must have an explicit adapter that knows how to read current state, prepare an exact change, apply it through a DSM-supported mechanism, and verify the result.

### Explicit exclusions

Even with user verification, V1 SHALL NOT provide:

- arbitrary root shell execution;
- arbitrary command execution as root;
- arbitrary file writes outside granted storage roots merely by naming a DSM path;
- raw block-device writes;
- direct undocumented DSM database mutation;
- bypass of Synology privilege/resource mechanisms.

These exclusions define how DSM administration is mediated; they do not reduce the full read/write storage authority inside granted storage roots.

Explicit V1 exclusions:

- arbitrary shell/command execution;
- root escalation;
- DSM user/group changes;
- shared-folder permission changes;
- package install/remove/update for other packages;
- service control for other packages;
- reboot/shutdown;
- firewall changes;
- storage-pool/RAID mutation;
- raw block-device writes;
- DSM configuration database writes.

These exclusions define the Synology device profile itself; they are not Executor "bounded mode." Windows devices remain full-authority workstation devices.

## SPK packaging

Package identity: `ExecutorNode`

`INFO` SHALL include at minimum:

```text
package="ExecutorNode"
version="0.1.0-0001"
arch="armada38x"
os_min_ver="7.2-64570"
maintainer="thebrazenbeard"
description="Executor Synology storage node"
```

`conf/privilege` SHALL use:

```json
{
  "defaults": {
    "run-as": "package"
  }
}
```

No root-run script is part of V1.

The installation wizard SHALL collect:

- Executor service URL;
- device ID, defaulting to the DSM hostname when possible;
- device credential/token;
- optional comma/newline-separated initial share roots.

Installer-provided roots are configuration requests, not permission grants. At startup the node marks each root `writable`, `read-only`, or `unavailable` based on the package account's actual DSM permissions; denied roots are never silently promoted.

Secrets SHALL be written to the package home/config area with package-user-only permissions and SHALL not be written to package logs or exported into arbitrary subprocess environments.

The package lifecycle SHALL:

- validate configuration on install/upgrade;
- preserve configuration across upgrades;
- start one ExecutorNode process;
- stop only its own recorded process;
- expose meaningful `start-stop-status` exit status;
- remove package-owned binaries/runtime files on uninstall;
- preserve user data in DSM shares.

## Configuration

Runtime configuration is stored in the package home, not under the immutable package target.

Conceptual configuration:

```json
{
  "executorUrl": "https://executor.example",
  "deviceId": "DS216",
  "deviceTokenFile": "/var/packages/ExecutorNode/home/device.token",
  "roots": [
    {
      "id": "media",
      "path": "/volume1/media",
      "mode": "rw"
    }
  ]
}
```

The device credential is stored separately from the non-secret config so config/status output cannot accidentally disclose it.

## Concurrency

The DS216 node SHALL advertise a device-local execution capacity lower than the Windows workstation default.

V1 Synology default: 2 concurrent device operations.

Reason: the control plane's 8 execution lanes are appropriate for workstation payloads, but the DS216 has 2 ARM cores and 512 MB RAM. Executor must not confuse global/control-plane capability with a weak device's safe local capacity.

This requires the Executor hello metadata to carry an optional `executionCapacity`. The server uses the smaller of:

- configured control-plane per-device ceiling;
- device-advertised capacity.

For DS216 V1 the advertised capacity is 2. Windows devices that omit the field retain the existing default of 8.

This is a scheduling/capacity declaration, not an authority restriction.

## Error and effect semantics

Synology node requests use the same Executor effect model:

- request not dispatched -> `FAILED`;
- observed successful response -> `COMPLETED`;
- connection loss/timeout after dispatch -> `OUTCOME_UNKNOWN`;
- no silent replay of an ambiguous mutating operation.

Storage mutation responses include enough result metadata to reconcile state, such as final path, size, modification time, and hash when explicitly requested.

## Build and CI

The SPK is built off-device.

CI jobs SHALL:

1. run Go unit tests on Linux;
2. run storage-path adversarial tests;
3. cross-compile `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0`;
4. verify the binary is ARM 32-bit and dynamically independent;
5. assemble DSM package structure;
6. validate required `INFO`, `conf/privilege`, scripts, icons, and package archive;
7. inspect the built archive to ensure no source credentials or local configuration are embedded;
8. upload `ExecutorNode-armada38x-<version>.spk` as a workflow artifact.

Synology's package toolkit may later be added as a qualification job. The NAS itself is not used as a compilation environment.

## Testing

Required unit/integration coverage:

- hello/profile metadata round trip;
- legacy Windows-device compatibility;
- advertised 2-lane Synology scheduling;
- all storage tools against temporary roots;
- traversal rejection;
- absolute-path rejection;
- nested symlink escape rejection;
- final-component symlink mutation rejection;
- symlink-swap/TOCTOU adversarial cases where reproducible;
- `@*` internal-directory rejection;
- atomic replacement behavior and interrupted-write cleanup;
- delete/copy/move cross-root semantics;
- large-file chunking and memory ceiling;
- reconnect behavior;
- secret redaction;
- malformed config handling;
- SPK lifecycle script static validation;
- SPK archive structure validation.

A physical DS216 installation remains a separate evidence class. CI success does not claim the SPK has installed or run successfully on Patrick's NAS.

## Hostile review

> **Challenge: combining full R/W data access and administrative control creates an attractive ransomware appliance.**
>
> A compromised device token could give an attacker destructive authority over every granted share. Adding a root shell would turn the same compromise into near-total NAS compromise.
>
> **Resolution:** storage authority remains intentionally strong, but administration is separately enumerated. V1 contains no generic command execution or root path. This preserves the requested data capability without converting one device credential into a universal DSM root credential.

> **Challenge: putting the Synology node in the main Executor repo creates platform coupling.**
>
> It does increase repository size and CI complexity.
>
> **Resolution:** keep it in the monorepo because the wire protocol, device metadata, authentication, routing, effect semantics, and release compatibility are shared contracts. The Go module remains isolated under `nodes/synology` so it can be split later without protocol redesign.

> **Challenge: reusing Desktop Commander would avoid implementing another MCP tool server.**
>
> On DS216 it would introduce a Node/runtime dependency and a desktop-oriented surface on a 512 MB ARMv7 storage appliance.
>
> **Resolution:** reject Desktop Commander for the NAS profile. A static Go node is smaller, has a narrower dependency chain, and maps authority to DSM semantics directly.

> **Challenge: "full storage" is misleading if the package account cannot automatically access every existing DSM share.**
>
> DSM 7 intentionally uses package identities and share permissions; a third-party lower-privilege package cannot truthfully guarantee automatic access to every pre-existing share.
>
> **Resolution:** define full storage authority precisely as full R/W inside every share explicitly granted to the ExecutorNode package account. Installation/status reports SHALL surface which configured roots are actually writable.

> **Challenge: ordinary canonical-path checking is vulnerable to symlink races.**
>
> An attacker or another local process could swap a path component after validation.
>
> **Resolution:** mutations are rooted in directory file descriptors and use no-follow semantics; symlinks are never traversed by V1 storage operations.

> **Challenge: forcing 8 device execution lanes onto a DS216 could make the NAS unstable.**
>
> The control plane's workstation default is not appropriate for a 2-core, 512 MB ARM appliance.
>
> **Resolution:** add device-advertised execution capacity and use 2 lanes for DS216 V1 while retaining 64 control-plane logic lanes and 8-lane Windows devices.

> **Challenge: allowing DSM changes after user confirmation could become a rubber-stamp path to root-equivalent administration.**
>
> A generic `admin.apply(command)` plus a confirmation prompt would not provide a meaningful boundary; it would simply move arbitrary administration behind one click.
>
> **Resolution:** there is no generic mutation command. Each supported DSM mutation has a typed adapter and a two-phase prepare/apply contract. The prepared change is immutable, one-time, short-lived, bound to current device generation and current target state, and must be re-prepared if state drifts. The user approves the exact diff, not a broad category of authority.
>
> **Challenge: ChatGPT could theoretically call the apply tool without meaningfully surfacing the proposal.**
>
> **Resolution:** the protocol and node enforce two-phase currentness and parameter binding, while the Executor skill/plugin contract SHALL require explicit user approval before apply. This is strong protection against stale/broadened mutations, but it is not a cryptographic proof of human attention. If later required, V2 may add a DSM-local approval challenge or second-factor confirmation without changing the storage architecture.

## Acceptance boundary

V1 is acceptable for implementation when the node remains a storage-access appliance for ChatGPT/Executor rather than a general DSM control surface, and:

- existing Windows Executor behavior remains backward compatible;
- the control plane can describe and route a `synology-storage` device;
- the Synology node builds as a static ARMv7 binary;
- an `armada38x` SPK is produced by CI;
- package privilege defaults to `run-as: package`;
- storage operations cannot escape granted roots through traversal or symlinks;
- all configured writable roots can be fully read/written/deleted by tools according to filesystem permission;
- broad DSM state/configuration may be read where supported;
- every DSM mutation is prepare -> explicit user verification -> apply -> readback;
- prepared mutations are single-use, short-lived, generation-bound, parameter-bound, and invalidated by state drift;
- no arbitrary root shell or undocumented DSM-database mutation exists;
- secrets are absent from logs/build artifacts/status responses;
- CI does not claim physical-NAS installation evidence.

## Implementation order

The eventual implementation plan should proceed in this dependency order:

1. backward-compatible device-profile/capacity protocol extension;
2. Go bridge skeleton and protocol tests;
3. rooted storage subsystem and hostile path tests;
4. limited admin subsystem;
5. DSM configuration and lifecycle files;
6. SPK assembly/build tooling;
7. CI artifact production and package validation;
8. physical DS216 installation/qualification as a separate operator step.
