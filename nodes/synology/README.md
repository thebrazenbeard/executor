# ExecutorNode for Synology

ExecutorNode is the native Executor device for a Synology DS216 running DSM 7.2.2 or newer.

It connects outbound to Executor's authenticated device ingress as a `synology-storage` profile. It does not launch Desktop Commander and does not require the OpenAI tunnel ID or tunnel API secret.

## Target

- NAS: Synology DS216
- package architecture: `armada38x`
- binary: Linux ARMv7, static, CGO disabled
- DSM minimum: DSM 7.2.2 build 72806 (`INFO` uses Synology's `os_min_ver="7.2-72806"` syntax)
- package: `ExecutorNode-armada38x-0.1.0-0004.spk`
- DSM privilege: `run-as: package`
- device execution capacity: 2 lanes
- Executor control-plane logic capacity: 64 lanes

Windows workstation devices retain their 8-lane qualified default. The lower DS216 capacity is a scheduling choice for the 2-core/512 MB NAS, not a reduction of storage authority.

## Storage authority

Configured share roots are root-relative capability boundaries. Within a root that DSM actually grants Read/Write to the ExecutorNode package user, storage tools can create, read, replace, append, copy, move, hash, search, and delete content.

The rooted filesystem layer rejects absolute caller paths, `..` traversal, DSM `@...` internals, symlink traversal, final-component symlink mutation, and descriptor/path-swap escape.
A configured path does not grant DSM permission by itself. Each root is reported as `writable`, `read-only`, or `unavailable` from the package user's observed access.

## DSM administration

Read-only DSM inspection is exposed through typed tools for system, storage, network, package, user/group, shared-folder, update, and ExecutorNode state where the package user can read the underlying state.

Supported mutations use a verified two-phase flow:

1. `admin.prepare_change` reads current state and creates a short-lived proposal.
2. ChatGPT presents the exact proposal, side effects, recovery information, expiration, and change ID.
3. The user explicitly approves that exact proposal.
4. `admin.apply_change` rechecks generation/currentness, applies once, and reads state back.

There is no generic root shell, arbitrary root command, raw block-device write, or undocumented DSM database mutation.

## Install

Download the `ExecutorNode-armada38x-0.1.0-0004.spk` artifact from the Synology CI job.

In DSM, open **Package Center > Manual Install**, select the SPK, and supply:

- the HTTPS Executor device-ingress URL;
- device ID, normally `DS216`;
- the mapped per-device credential for that ID; and
- comma-separated share roots such as `/volume1/media,/volume1/backups`.
After installation, open **Control Panel > Shared Folder > Edit > Permission > System internal user** and grant the `ExecutorNode` package user **Read/Write** on each share ChatGPT should be able to modify.

The package stores:

- non-secret node configuration in `$SYNOPKG_PKGVAR/config.json`;
- the device token separately in `$SYNOPKG_PKGHOME/device.token` with mode 0600;
- runtime PID/log state only under the package var directory.

## Build and validate

From the repository root on a Linux-compatible shell with Go 1.24+:

```sh
bash nodes/synology/tests/spk_test.sh
bash nodes/synology/build-spk.sh
bash nodes/synology/validate-spk.sh
```

The validator expands both archive layers, checks required Package Center metadata, verifies the inner executable is ELF32 little-endian ARM with no `PT_INTERP`, validates package privilege and icons, and scans the artifact for forbidden secret markers.

The installer wizard source under `synology/WIZARD_UIFILES-src` follows Synology's DSM 7.2.2 Vue 2.7.14 custom-render format. The compiled `WIZARD_UIFILES/install_uifile` is checked in and is the canonical package input; normal SPK CI does not install or execute the nested wizard development dependencies.

Synology's documented Vue 2-era development stack is EOL and its pinned build dependency tree may report npm audit findings. Those dependencies are not included in the SPK and are not needed to assemble or validate the checked-in wizard output.

## Restart qualification

ExecutorNode restart is a verified mutation with deferred completion. A replacement process initializes behind a gate; the immediate apply response is written before release and reports `pendingVerification: true, verified: false`; the new connection reports a new generation; only the post-reconnect checks establish completed verification, then the old process exits.
Automated tests cover startup failure, replacement connection timeout, duplicate release prevention, stale-generation proposal rejection, state drift, concurrent double-apply, and twenty consecutive real replacement-process handoffs. Local development also supports repeating that twenty-cycle test multiple times.

Physical DS216 qualification repeats an approved restart three times and checks for a single generation increment, no duplicate/orphaned process, and working storage/admin tools after each reconnect.

## Evidence boundary

A green CI artifact proves repository-controlled build, test, architecture, and package checks. It does not prove:

- successful physical installation of the SPK on a particular DS216;
- the package user has permission to a particular share;
- idle RSS is below the design target on physical hardware;
- a live Executor control plane/device ingress is reachable; or
- physical restart behavior has been observed.

Use `QUALIFICATION.md` for those on-device checks.
