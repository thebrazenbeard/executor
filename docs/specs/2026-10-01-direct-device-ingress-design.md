# Direct Executor Device Ingress Design

Date: 2026-10-01
Status: Approved for implementation
Constraint: recurring cost $0 and no third-party request/bandwidth relay limit in the device path

## Decision

Replace the Cloudflare Quick Tunnel development path with direct self-hosted TLS ingress.

ChatGPT continues to reach Executor through OpenAI Secure MCP Tunnel on the private MCP listener. Workstation/Synology devices connect directly to an operator-controlled public TCP port. No Cloudflare Tunnel, Tailscale Funnel, VPS relay, or other traffic intermediary sits between the device and Executor.

## TLS

A locally installed Caddy binary terminates TLS and reverse-proxies only to Executor's loopback device listener. Caddy uses its internal CA (`tls internal`). Its data directory is persistent under the Executor runtime root so the CA remains stable when the public IP changes.

Enrollment distributes only the public CA certificate. The CA private key never leaves the control-plane host. Executor's device agent accepts an optional CA PEM path and supplies it to the WebSocket TLS client.

## Direct network path

Default public/device TLS port: 9443/TCP.

Startup:
1. starts the existing headless Executor control plane;
2. resolves a public IPv4 address unless `-PublicHost` is supplied;
3. installs/reuses an official Caddy release verified against the release's SHA-512 checksum file;
4. creates an inbound Windows Firewall rule for the configured TCP port;
5. attempts UPnP IGD static port mapping when available;
6. starts Caddy with an internal certificate for the public host and a reverse proxy to `127.0.0.1:8788`;
7. retrieves the persistent Caddy root CA certificate;
8. verifies the local TLS route with the root CA while resolving the public host to loopback;
9. optionally emits a laptop enrollment command including the CA certificate.

No relay fallback is permitted.

## NAT/CGNAT

UPnP success is evidence that a local router accepted the mapping, not proof of end-to-end reachability. If automatic mapping is unavailable, startup reports the exact manual TCP port-forward requirement.

CGNAT cannot be bypassed while preserving the no-relay constraint. Executor therefore reports direct reachability as unqualified until a remote probe succeeds. It never substitutes a rate-limited relay.

## Endpoint changes

A changing public IP requires restarting the direct ingress with the new public host. The persistent Caddy CA remains the same, so installed laptops need only a service-URL update; they do not need a new trust root or device credential.

## Cost/rate boundary

Caddy is local open-source software. Direct device traffic flows over the operator's own network connection. There is no third-party per-request, in-flight-request, or bandwidth quota in the Executor device path. ISP/network capacity and Executor's configured lanes remain real limits.

The OpenAI Secure MCP Tunnel remains a separate MCP transport and is not used for device attachment.
