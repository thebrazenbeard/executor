import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no local port");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return addr.port;
}
async function withGateway(run: (port: number, ingress: number, child: ChildProcess) => Promise<void>) {
  const port = await unusedPort(), ingress = await unusedPort();
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
      EXECUTOR_DEVICE_HOST: "127.0.0.1", EXECUTOR_DEVICE_PORT: String(ingress),
      EXECUTOR_CLIENT_TOKEN: "synthetic-only-client", EXECUTOR_DEVICE_TOKEN: "synthetic-only-device",
      EXECUTOR_DEVICE_TOKENS_FILE: "", EXECUTOR_DEVICE_TOKENS_JSON: "",
      EXECUTOR_DEFAULT_DEVICE: "", EXECUTOR_EXECUTION_EVENT_FILE: "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  try {
    let online = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error("gateway exited during startup");
      try { online = (await fetch("http://127.0.0.1:" + port + "/health")).ok; } catch {}
      if (online) break;
      await delay(80);
    }
    assert.equal(online, true, "disposable gateway must become healthy");
    await run(port, ingress, child);
  } finally {
    child.kill();
  }
}
async function attach(port: number, replyBytes?: number) {
  const ws = new WebSocket("ws://127.0.0.1:" + port + "/device", { maxPayload: 20_000_000 });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", deviceId: "synthetic-device",
    token: "synthetic-only-device", initializeResult: { protocolVersion: "2025-06-18" } }));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("device did not register")), 3000);
    ws.once("message", data => { clearTimeout(timeout);
      try { assert.equal(JSON.parse(data.toString()).type, "ready"); resolve(); } catch (e) { reject(e); }
    });
    ws.once("close", () => { clearTimeout(timeout); reject(new Error("device closed before ready")); });
  });
  if (replyBytes) ws.on("message", data => {
    const incoming = JSON.parse(data.toString());
    if (incoming.type === "request") ws.send(JSON.stringify({
      type: "response", requestId: incoming.requestId,
      payload: { jsonrpc: "2.0", id: incoming.payload.id,
        result: { content: [{ type: "text", text: "x".repeat(replyBytes) }] } }
    }));
  });
  return ws;
}
async function abortedPost(port: number) {
  await new Promise<void>(resolve => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/mcp", method: "POST",
      headers: { authorization: "Bearer synthetic-only-client",
        "content-type": "application/json", "content-length": 800_000 } });
    req.on("error", () => {});
    req.write('{"jsonrpc":"2.0","id":1,"method":"ping","unfinished":"');
    setTimeout(() => { req.destroy(); resolve(); }, 70);
  });
}
test("oversized device result above old 2 MB limit reaches authenticated MCP caller", { timeout: 15000 }, async () => {
  await withGateway(async (port, ingress) => {
    const device = await attach(ingress, 2_300_000);
    try {
      const resp = await fetch("http://127.0.0.1:" + port + "/mcp", { method: "POST",
        headers: { authorization: "Bearer synthetic-only-client", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call",
          params: { name: "synthetic-only", arguments: {} } }) });
      const body = await resp.text();
      assert.equal(resp.status, 200);
      assert.ok(body.length > 2_300_000);
      assert.equal((await fetch("http://127.0.0.1:" + port + "/health")).status, 200);
    } finally { device.terminate(); }
  });
});
test("aborted authenticated HTTP request leaves the MCP listener alive", { timeout: 15000 }, async () => {
  await withGateway(async (port, _ingress, child) => {
    await abortedPost(port);
    await delay(250);
    assert.equal(child.exitCode, null, "aborted request must not terminate gateway");
    const resp = await fetch("http://127.0.0.1:" + port + "/health");
    assert.equal(resp.status, 200);
  });
});
