# Device connection and Windows startup recovery

The device agent sends WebSocket ping frames every 15 seconds. If a peer fails to
answer before the next interval, the agent terminates that connection and uses
the existing reconnect path. A healthy TCP socket alone is not proof that the
device is attached. The heartbeat timer is removed on close.

## Windows installed devices

The installer defaults to startup at the current user's sign-in. To start before
sign-in, supply that same account's credential:

~~~powershell
$credential = Get-Credential
.\scripts\Set-ExecutorInstalledDeviceStartup.ps1 -AtStartup -Credential $credential -DryRun
.\scripts\Set-ExecutorInstalledDeviceStartup.ps1 -AtStartup -Credential $credential
~~~

Run this as the Windows account that owns the installed device's DPAPI token.
Task Scheduler stores the supplied logon credential; the device JSON and script
logs do not store its password. Account policy must permit batch logon. Reapply
the credential if the account password changes. The helper backs up an existing
task, preserves device enrollment, adds boot and sign-in triggers in unattended
mode, removes the default task duration cutoff, and configures three retries.

New enrollment keeps its existing sign-in startup and selected source ref.
After enrollment, use this helper to select unattended boot. The installer stays
self-contained so installing a previously pinned source ref does not depend on
new helper files being present in that older agent checkout.

The launcher refuses a duplicate agent or occupied launcher lock with exit 20;
that result does not establish connectivity. A managed Windows agent watches its
launcher PID and stops its own payload when the launcher disappears, so stopping
a scheduled launcher does not leave its agent running indefinitely.

## Verification

npm test includes real responsive/silent WebSocket peers, launcher disappearance,
and Windows-only startup dry-run and duplicate-process regressions. The dry-run
test supplies a synthetic credential and verifies no task is registered.

A restart test needs an actual command through the connector after automatic
recovery. A full reboot test additionally needs changed OS boot evidence and no
manual launch before checking recovery. Local health and source tests do not
replace those observations.
