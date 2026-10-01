const base = process.env.EXECUTOR_QUAL_BASE ?? "http://127.0.0.1:18991";
const headers = {
  authorization: "Bearer qualification-client",
  "content-type": "application/json",
  "x-executor-device": "qualification"
};

let maxExecutionActive = 0;
let maxExecutionQueued = 0;
let maxLogicActive = 0;
let maxLogicQueued = 0;
let stopped = false;
let capacityMismatch = false;

const sampler = (async () => {
  while (!stopped) {
    try {
      const r = await fetch(base + "/health");
      const h = await r.json();
      maxExecutionActive = Math.max(maxExecutionActive, Number(h.executionActive ?? 0));
      maxExecutionQueued = Math.max(maxExecutionQueued, Number(h.executionQueued ?? 0));
      maxLogicActive = Math.max(maxLogicActive, Number(h.upstreamContextActive ?? 0));
      maxLogicQueued = Math.max(maxLogicQueued, Number(h.upstreamContextQueued ?? 0));
      if (h.executionCapacityPerDevice !== 8 || h.upstreamContextCapacity !== 64) {
        capacityMismatch = true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 20));
  }
})();

const calls = Array.from({ length: 64 }, (_, n) => fetch(base + "/mcp", {
  method: "POST",
  headers,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1000 + n,
    method: "tools/call",
    params: {
      name: "start_process",
      arguments: {
        command: 'powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500; Write-Output EXECUTOR_LANE_OK"',
        timeout_ms: 5000
      }
    }
  })
}).then(async r => {
  const body = await r.json();
  if (!r.ok || body.error) throw new Error("real payload call failed: " + JSON.stringify(body));
  return body;
}));

try {
  await Promise.all(calls);
} finally {
  stopped = true;
  await sampler;
}

if (capacityMismatch) throw new Error("qualification capacity is not 8 execution / 64 logic lanes");
if (maxExecutionActive < 8) throw new Error(`execution overlap below target: maxExecutionActive=${maxExecutionActive}`);
if (maxLogicActive < 64) throw new Error(`logic overlap below target: maxLogicActive=${maxLogicActive}`);

console.log(JSON.stringify({
  status: "PASS",
  calls: calls.length,
  maxExecutionActive,
  maxExecutionQueued,
  maxLogicActive,
  maxLogicQueued
}));
