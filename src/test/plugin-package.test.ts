import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Executor plugin package is named and intentionally unbound", async () => {
  const plugin = JSON.parse(await readFile("plugin.json", "utf8"));
  const mcp = JSON.parse(await readFile("mcp.json", "utf8"));
  const legacyMcp = JSON.parse(await readFile(".mcp.json", "utf8"));
  const codex = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));

  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name, "executor");
  assert.equal(plugin.extensions?.["com.openai"]?.interface?.displayName, "Executor");
  assert.equal("mcpServers" in plugin, false);

  assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.deepEqual(mcp.mcpServers, {});
  assert.deepEqual(legacyMcp, mcp);

  assert.equal(codex.name, "executor");
  assert.equal(codex.interface?.displayName, "Executor");
});

test("self-hosted tunnel profile keeps credentials external and allows 64 upstream requests", async () => {
  const profile = await readFile("deploy/tunnel-client.executor.example.yaml", "utf8");
  const launcher = await readFile("scripts/Start-ExecutorTunnel.ps1", "utf8");

  assert.match(profile, /url: http:\/\/127\.0\.0\.1:8787\/mcp/);
  assert.match(profile, /max_concurrent_requests: 64/);
  assert.equal(profile.includes("Authorization:"), false);
  assert.equal(profile.includes("api_key:"), false);
  assert.equal(profile.includes("Bearer "), false);

  assert.match(launcher, /EXECUTOR_TUNNEL_ID/);
  assert.match(launcher, /EXECUTOR_TUNNEL_API_SECRET/);
  assert.match(launcher, /CONTROL_PLANE_TUNNEL_ID/);
  assert.match(launcher, /CONTROL_PLANE_API_KEY/);
  assert.match(launcher, /MCP_EXTRA_HEADERS/);
  assert.match(launcher, /doctor --profile-file/);
  assert.match(launcher, /run --profile-file/);
});
