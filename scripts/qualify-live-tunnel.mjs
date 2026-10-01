import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const remoteMcpUrl = process.env.EXECUTOR_REMOTE_MCP_URL?.trim();
const remoteAuthorization = process.env.EXECUTOR_REMOTE_AUTHORIZATION?.trim();
const deviceId = process.env.EXECUTOR_REMOTE_DEVICE_ID?.trim();
const localHealthUrl = (process.env.EXECUTOR_LOCAL_HEALTH_URL ?? "http://127.0.0.1:8787/health").trim();
const localClientToken = process.env.EXECUTOR_CLIENT_TOKEN?.trim();
const probeCommand = process.env.EXECUTOR_REMOTE_PROBE_COMMAND?.trim()
  || 'powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500; Write-Output EXECUTOR_TUNNEL_LANE_OK"';

if (!remoteMcpUrl) throw new Error("EXECUTOR_REMOTE_MCP_URL is required");
if (!deviceId) throw new Error("EXECUTOR_REMOTE_DEVICE_ID is required");
if (!localClientToken) throw new Error("EXECUTOR_CLIENT_TOKEN is required to read detailed local /health counters");

const remoteHeaders = {};
if (remoteAuthorization) remoteHeaders.authorization = remoteAuthorization;

const transport = new StreamableHTTPClientTransport(new URL(remoteMcpUrl), {
  requestInit: { headers: remoteHeaders }
});
const client = new Client({ name: "executor-live-tunnel-qualifier", version: "1.0.0" });

let stopped = false;
let maxExecutionActive = 0;
let maxExecutionQueued = 0;
let maxLogicActive = 0;
let maxLogicQueued = 0;
let capacityMismatch = false;
let samples = 0;

const healthHeaders = {
  authorization: `Bearer ${localClientToken}`
};

const sampler = (async () => {
  while (!stopped) {
    try {
      const response = await fetch(localHealthUrl, { headers: healthHeaders });
      if (!response.ok) throw new Error(`health HTTP ${response.status}`);
      const health = await response.json();

      maxExecutionActive = Math.max(maxExecutionActive, Number(health.executionActive ?? 0));
      maxExecutionQueued = Math.max(maxExecutionQueued, Number(health.executionQueued ?? 0));
      maxLogicActive = Math.max(maxLogicActive, Number(health.upstreamContextActive ?? 0));
      maxLogicQueued = Math.max(maxLogicQueued, Number(health.upstreamContextQueued ?? 0));

      if (health.executionCapacityPerDevice !== 8 || health.upstreamContextCapacity !== 64) {
        capacityMismatch = true;
      }
      samples += 1;
    } catch {
      // Startup/transient sampling errors do not invalidate the run by themselves.
      // A zero-sample run is rejected below.
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
})();

try {
  await client.connect(transport);

  const listed = await client.listTools();
  if (!listed.tools.some(tool => tool.name === "start_process")) {
    throw new Error("remote Executor endpoint does not expose start_process");
  }

  const calls = Array.from({ length: 64 }, (_, index) =>
    client.callTool({
      name: "start_process",
      arguments: {
        command: probeCommand,
        timeout_ms: 5000,
        deviceId
      }
    }).then(result => {
      if (result.isError) {
        throw new Error(`remote call ${index + 1} returned an MCP tool error`);
      }
      return result;
    })
  );

  await Promise.all(calls);
} finally {
  stopped = true;
  await sampler;
  await client.close().catch(() => {});
}

if (samples === 0) throw new Error("no authenticated local /health samples were observed");
if (capacityMismatch) throw new Error("runtime capacity is not 8 execution / 64 logic lanes");
if (maxExecutionActive < 8) {
  throw new Error(`live tunnel execution overlap below target: maxExecutionActive=${maxExecutionActive}`);
}
if (maxLogicActive < 64) {
  throw new Error(`live tunnel logic overlap below target: maxLogicActive=${maxLogicActive}`);
}

console.log(JSON.stringify({
  status: "PASS",
  route: "LIVE_REMOTE_TUNNEL",
  remoteMcpUrl,
  deviceId,
  calls: 64,
  samples,
  maxExecutionActive,
  maxExecutionQueued,
  maxLogicActive,
  maxLogicQueued
}));
