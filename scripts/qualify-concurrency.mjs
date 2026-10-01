const base = process.env.WBC_QUAL_BASE ?? "http://127.0.0.1:18991";
const headers = {
  authorization: "Bearer qualification-client",
  "content-type": "application/json",
  "x-executor-device": "qualification"
};

let maxActive = 0;
let maxQueued = 0;
let stopped = false;
let capacityMismatch = false;
const sampler = (async () => {
  while (!stopped) {
    try {
      const r = await fetch(base + "/health");
      const h = await r.json();
      maxActive = Math.max(maxActive, Number(h.executionActive ?? 0));
      maxQueued = Math.max(maxQueued, Number(h.executionQueued ?? 0));
      if (h.executionCapacityPerDevice !== 8 || h.upstreamContextCapacity !== 64) {
        capacityMismatch = true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 25));
  }
})();

const calls = Array.from({ length: 8 }, (_, n) => fetch(base + "/mcp", {
  method: "POST",
  headers,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 100 + n,
    method: "tools/call",
    params: {
      name: "start_process",
      arguments: {
        command: 'powershell -NoProfile -Command "Start-Sleep -Seconds 3; Write-Output WBC_LANE_OK"',
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
if (capacityMismatch) throw new Error("qualification capacity is not 8/64");
if (maxActive < 4) throw new Error(`real-payload overlap below floor: maxActive=${maxActive}, maxQueued=${maxQueued}`);
console.log(JSON.stringify({ status: "PASS", maxActive, maxQueued, calls: calls.length }));
