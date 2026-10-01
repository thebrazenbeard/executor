import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

test("NAT-PMP codec emits and parses a TCP mapping request", async () => {
  const moduleUrl = pathToFileURL(resolve("scripts/nat-pmp-port-map.mjs")).href;
  const nat = await import(moduleUrl);

  const request = nat.buildMapRequest("tcp", 9443, 9443, 120);
  assert.deepEqual([...request], [0, 2, 0, 0, 0x24, 0xe3, 0x24, 0xe3, 0, 0, 0, 120]);

  const response = Buffer.from("008200000030c53724e324e300000078", "hex");
  assert.deepEqual(nat.parseMapResponse(response, "tcp"), {
    version: 0,
    opcode: 130,
    resultCode: 0,
    epochSeconds: 3196215,
    internalPort: 9443,
    externalPort: 9443,
    lifetimeSeconds: 120
  });
});

test("direct runtime falls back to a renewable NAT-PMP lease and cleans it up", async () => {
  const start = await readFile("scripts/Start-ExecutorDirect.ps1", "utf8");
  const stop = await readFile("scripts/Stop-ExecutorDirect.ps1", "utf8");
  const status = await readFile("scripts/Get-ExecutorDirectStatus.ps1", "utf8");
  const helper = await readFile("scripts/nat-pmp-port-map.mjs", "utf8");

  assert.match(start, /nat-pmp-port-map\.mjs/i);
  assert.match(start, /nat_pmp_mapping_created/i);
  assert.match(start, /nat_pmp_pid/i);
  assert.match(start, /nat_pmp_gateway/i);
  assert.match(start, /lease/i);
  assert.match(stop, /nat-pmp-port-map\.mjs/i);
  assert.match(stop, /nat_pmp_mapping_created/i);
  assert.match(status, /nat_pmp_mapping_created/i);
  assert.match(status, /nat_pmp_alive/i);

  assert.match(helper, /createSocket\(["']udp4["']\)/i);
  assert.match(helper, /5351/);
  assert.equal(/cloudflare|tailscale|ngrok/i.test(helper), false);
});