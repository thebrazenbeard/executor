# Executor plugin recovery + desktop companion plan

Date: 2026-10-06
Source base: build/executor-v1@ae853df7a4f67a3f6ade1181d3468cb4475b55da

## Goal

Repair the observed ChatGPT connector split state where workstation execution succeeds while `list_devices` reports no devices, make the recovery durable in source, and add a Windows desktop companion for local status and narrow MCP-session repair.

## Tasks

1. Preserve the existing device-registry routing contract and reproduce the operational symptom against live Lappy evidence.
2. Make `Restart-ExecutorControlPlane.ps1` recover the existing direct-runtime profile, credential-file binding, ports, and device identity without creating a new tunnel or changing firewall/UPnP/NAT-PMP state.
3. Add Executor Desktop as a Wails v2 Windows companion that reads control-plane/ChatGPT status and exposes only the narrow control-plane repair action.
4. Commit reproducible dependency locks, update the MCP SDK to a non-vulnerable compatible version, and add Windows desktop CI/artifact publication.
5. Run full TypeScript, PowerShell parse, desktop Go tests/build, live Lappy repair, and independent RDC readback before opening a draft PR.

## Evidence ceiling

Source tests/builds do not establish installation. The live repair qualification applies only to the exact Lappy runtime observed during this work. Main, deployment, installation, and release remain separate effects.
