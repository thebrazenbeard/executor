import { readFile } from "node:fs/promises";
import https from "node:https";
import WebSocket from "ws";

const base = process.env.EXECUTOR_DIRECT_QUAL_URL;
const caPath = process.env.EXECUTOR_DIRECT_QUAL_CA;
const token = process.env.EXECUTOR_DIRECT_QUAL_TOKEN;
const tlsServerName = process.env.EXECUTOR_DIRECT_QUAL_TLS_SERVER_NAME ?? "executor-device.invalid";
if (!base || !caPath || !token) throw new Error("direct qualifier environment is incomplete");

const ca = await readFile(caPath);
const baseUrl = new URL(base);
const port = baseUrl.port || "443";
const hostHeader = port === "443" ? tlsServerName : `${tlsServerName}:${port}`;

const url = new URL(base);
url.pathname = "/device";
url.protocol = "wss:";

const ws = new WebSocket(url, {
  ca,
  maxPayload: 2_000_000,
  servername: tlsServerName,
  headers: { Host: hostHeader }
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("direct WSS hello timed out")), 10_000);
  ws.once("error", reject);
  ws.on("message", raw => {
    const message = JSON.parse(raw.toString());
    if (message.type !== "ready") return;
    clearTimeout(timer);
    resolve();
  });
  ws.once("open", () => {
    ws.send(JSON.stringify({
      type: "hello",
      deviceId: "direct-ci",
      token,
      initializeResult: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "executor-direct-ci", version: "1.0.0" }
      }
    }));
  });
});

const health = await new Promise((resolve, reject) => {
  const target = new URL("/health", base);
  const req = https.get(target, {
    ca,
    servername: tlsServerName,
    headers: { Host: hostHeader },
    rejectUnauthorized: true
  }, res => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", chunk => body += chunk);
    res.on("end", () => {
      try {
        if (res.statusCode !== 200) throw new Error("health status " + res.statusCode);
        resolve(JSON.parse(body));
      } catch (error) { reject(error); }
    });
  });
  req.once("error", reject);
});

if (health?.role !== "device-ingress") throw new Error("direct TLS route did not reach device ingress");
ws.close();
console.log(JSON.stringify({
  status: "PASS",
  transport: "direct-wss",
  tls: "caddy-internal-ca",
  tlsServerName,
  deviceHello: true
}));
