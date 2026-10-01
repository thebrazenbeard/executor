# Executor setup

Executor provides a self-hosted remote MCP path to a full Desktop Commander workstation payload.

## Build

```powershell
npm install --ignore-scripts
npm test
npm run build
```

## Install the workstation payload

```powershell
.\scripts\Install-ExecutorDesktopCommander.ps1
```

The installer builds the exact pinned Desktop Commander source and prints the SHA-256 of `executor-desktop-commander.manifest.json`. Keep that digest as the external trust anchor used by the device agent.

The installer intentionally does not apply the donor WorkBridge four-process overlay. Executor's qualified baseline is 8 parallel execution lanes and 64 parallel logic lanes.

## Start the service

Configure `EXECUTOR_CLIENT_TOKEN`, `EXECUTOR_DEVICE_TOKEN`, `EXECUTOR_EXECUTION_CAPACITY=8`, `EXECUTOR_LOGIC_CAPACITY=64`, and the allowed browser origin. Start Executor with `npm start`.

For the private tunnel-first path, bind the service to loopback on port 8787.

## Attach a workstation

Run `scripts/Start-ExecutorDevice.ps1` with the Executor service URL, a device ID, the device token, the trusted manifest SHA-256, and the Desktop Commander install root.

Connected devices are visible through `list_devices`. Executor remains connectable and exposes `list_devices` even when all workstation agents are offline.

## Start the private tunnel

Provide your tunnel identity, runtime API credential, and Executor client token as runtime environment values, then run:

```powershell
.\scripts\Start-ExecutorTunnel.ps1
```

The checked-in profile allows 64 concurrent upstream requests. No live credential or tunnel identity belongs in Git history.

## Connect the AI client

Bind ChatGPT or another remote-MCP-capable client to the actual endpoint associated with your private tunnel.

Executor injects an optional `deviceId` argument into downstream workstation tool schemas. Executor consumes that routing field and removes it before dispatch, preserving the underlying Desktop Commander tool semantics.

## Evidence boundary

Repository CI proves source/build behavior and real-payload 8/64 concurrency on its qualification runner. It does not prove that a personal tunnel is currently active or that a specific workstation is currently connected.
