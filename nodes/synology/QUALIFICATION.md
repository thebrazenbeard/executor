# DS216 Physical Qualification

This checklist records evidence that cannot be established by repository CI alone.

CI may prove source tests, Linux/ARMv7 cross-build, SPK structure, static ELF properties, lifecycle-script behavior in a fixture environment, and automated restart handoff semantics. It does not prove that a particular physical Synology DS216 accepted, ran, or survived repeated restart of the package.

## Preconditions

Record before beginning:

- NAS model: Synology DS216
- DSM version:
- ExecutorNode SPK version:
- SPK SHA-256:
- Executor server exact Git head:
- ExecutorNode device ID:
- Initial Executor device generation:
- Granted DSM storage roots:
- Operator/reviewer:
- Qualification date/time:

Use only a disposable test directory inside a share explicitly granted to the ExecutorNode package user. Do not use irreplaceable user data as qualification material.

## Installation and attachment

1. Download the CI artifact `ExecutorNode-armada38x-0.1.0-0001.spk`.
2. In DSM Package Center, choose **Manual Install** and install the SPK.
3. Supply the TLS Executor device-ingress URL, the DS216 device ID, its mapped device credential, and intended share roots.
4. In **Control Panel > Shared Folder > Edit > Permission > System internal user**, grant the `ExecutorNode` package user **Read/Write** on the chosen test shares.
5. Confirm Package Center reports ExecutorNode running.
6. From Executor `list_devices`, require:
   - `kind: synology-storage`
   - `platform: linux`
   - `arch: armv7`
   - `packageArch: armada38x`
   - effective execution capacity: 2
   - a positive connection generation.
## Disposable storage qualification

Create a dedicated test root such as `<granted-share>/ExecutorNodeQualification`.

Require all of the following to succeed through Executor:

1. create nested directories;
2. write a UTF-8 file;
3. write/read binary data using base64;
4. read the file in bounded chunks;
5. append data;
6. stat and list the resulting tree;
7. compute SHA-256 and compare with an independently computed expected hash;
8. copy a file;
9. move/rename it;
10. run literal name search and bounded content search;
11. report storage capacity;
12. delete the disposable tree.

Require all of the following to be rejected:

- `../` traversal;
- an absolute caller path such as `/etc/passwd`;
- `@appstore` or another DSM internal `@...` top-level target;
- a symlink inside the granted root that points outside the root;
- a final-component symlink used as a mutation target.

Record the actual tool results and any unexpected filesystem side effects.

## DSM read qualification

Exercise the supported read-only admin tools:

- `admin.system_info`
- `admin.storage_info`
- `admin.network_info`
- `admin.package_status`
- `admin.user_group_info`
- `admin.shared_folder_info`
- `admin.update_info`
- `admin.executor_status`

Confirm sensitive credential/password/token material is not exposed in returned data.
## Verified restart qualification

ExecutorNode restart is a DSM mutation. Do not call `admin.apply_change` until the exact prepared proposal has been shown to the user and the user explicitly approves it.

For each restart cycle:

1. Read `admin.executor_status` and `list_devices`; record the current generation N.
2. Call `admin.prepare_change` for `executor.restart`.
3. Record the proposal's change ID, current state, proposed state, side effects, recovery information, generation, and expiry.
4. Verify no restart occurs before user approval.
5. Obtain explicit user approval for that exact proposal/change ID.
6. Call `admin.apply_change`.
7. Require the successful apply response to arrive before the old device connection disappears.
8. Observe the device temporarily disconnect/reconnect as applicable; never replay the restart call.
9. Require the returning device to report generation N+1 exactly—not N and not a jump caused by duplicate replacement processes.
10. Require `ping` and `tools/list` after reconnect.
11. Write and read a disposable storage file after reconnect.
12. Read `admin.executor_status` after reconnect.
13. Confirm only one ExecutorNode package process remains and no stale/orphaned replacement process remains.
14. Confirm the previously used change ID cannot be applied a second time.

Repeat the entire approved restart cycle **three times on the physical DS216**. Record each before/after generation and process observation separately.

A physical restart qualification fails if any cycle produces an ambiguous apply result, duplicate generation transition, orphan process, lost configuration/token, unavailable storage tools after reconnect, or requires manual process cleanup.

## Package stop/start qualification

Separately from self-restart:

1. record the current non-secret configuration and confirm the token file exists without exposing its contents;
2. stop ExecutorNode through Package Center;
3. confirm the device becomes offline;
4. start ExecutorNode through Package Center;
5. confirm it reconnects with the same device ID and configured roots;
6. verify storage read/write and `admin.executor_status` again;
7. confirm package stop/start did not rewrite or lose the configuration or device credential.

This is distinct from the `executor.restart` handoff path and both must work.
## Resource qualification

With the node connected and idle, record ExecutorNode RSS on the DS216.

Design target: **below 32 MB steady-state idle RSS**.

Also record:

- CPU while idle;
- CPU during a representative 512 KiB read/write;
- RSS during a large streamed hash/copy;
- whether DSM reports memory pressure or package instability.

The 32 MB RSS target remains unverified until measured on the physical DS216.

## Evidence record

| Field | Result |
|---|---|
| NAS model | |
| DSM version | |
| ExecutorNode version | |
| SPK SHA-256 | |
| Executor server exact head | |
| Device ID | |
| Granted roots | |
| Initial generation | |
| Storage tool suite | PASS / FAIL |
| Escape rejection suite | PASS / FAIL |
| DSM read suite | PASS / FAIL |
| Restart cycle 1 generation | |
| Restart cycle 1 process check | PASS / FAIL |
| Restart cycle 2 generation | |
| Restart cycle 2 process check | PASS / FAIL |
| Restart cycle 3 generation | |
| Restart cycle 3 process check | PASS / FAIL |
| Package stop/start | PASS / FAIL |
| Idle RSS | |
| Peak observed RSS | |
| Failures/notes | |
| Reviewer | |
| Date | |

Do not mark the DS216 physically qualified until every required item above has direct on-device evidence. Repository CI success, a successfully built SPK, or a successful installation alone is not physical qualification.
