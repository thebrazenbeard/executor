import { readFile } from "node:fs/promises";
import https from "node:https";
import net from "node:net";

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return "";
  return process.argv[index + 1];
}

const urlText = argValue("--url");
const caPath = argValue("--ca");
const resolveToLoopback = process.argv.includes("--resolve-to-loopback");

if (!urlText || !caPath) {
  console.error("usage: node probe-device-ingress.mjs --url <https-url> --ca <root-ca.pem> [--resolve-to-loopback]");
  process.exit(2);
}

const target = new URL(urlText);
if (target.protocol !== "https:") {
  console.error("direct ingress probe requires https");
  process.exit(2);
}

const ca = await readFile(caPath);
const port = target.port ? Number(target.port) : 443;

const options = {
  protocol: "https:",
  hostname: target.hostname,
  port,
  path: "/health",
  method: "GET",
  ca,
  rejectUnauthorized: true,
  headers: { accept: "application/json" },
  timeout: 5000,
  ...(resolveToLoopback
    ? {
        lookup: (_hostname, _options, callback) =>
          callback(null, "127.0.0.1", 4),
      }
    : {}),
  ...(net.isIP(target.hostname) ? {} : { servername: target.hostname }),
};

const result = await new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => {
      if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
        reject(new Error(`health returned HTTP ${res.statusCode}`));
        return;
      }
      try {
        const parsed = JSON.parse(body);
        if (parsed.status !== "ok" || parsed.role !== "device-ingress") {
          reject(new Error("unexpected device-ingress health response"));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
  req.on("timeout", () => req.destroy(new Error("direct ingress probe timed out")));
  req.on("error", reject);
  req.end();
});

process.stdout.write(JSON.stringify({
  status: "PASS",
  endpoint: target.origin,
  role: result.role,
  resolve_to_loopback: resolveToLoopback,
}) + "\n");
