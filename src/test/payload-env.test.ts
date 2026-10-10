import test from "node:test";
import assert from "node:assert/strict";
import { payloadEnvironment } from "../payload-env.js";

test("payload environment preserves ordinary workstation context but strips Executor and tunnel credentials", () => {
  const env = payloadEnvironment({
    PATH: "C:\\Windows\\System32",
    USERPROFILE: "C:\\Users\\patrick",
    MY_TOOLCHAIN_VAR: "keep-me",
    EXECUTOR_CLIENT_TOKEN: "client-secret",
    executor_device_token: "device-secret",
    EXECUTOR_DEVICE_TOKENS_JSON: "{\"alpha\":\"secret\"}",
    EXECUTOR_TUNNEL_API_SECRET: "tunnel-secret",
    CONTROL_PLANE_API_KEY: "control-secret",
    CONTROL_PLANE_TUNNEL_ID: "tunnel-id",
    MCP_EXTRA_HEADERS: "Authorization: Bearer secret",
    OPENAI_TUNNEL_RUNTIME_API_KEY: "legacy-secret",
    OPENAI_MCP_TUNNEL_ID: "legacy-id",
    HEALTH_URL_FILE: "C:\\temp\\health.txt"
  });

  assert.equal(env.PATH, "C:\\Windows\\System32");
  assert.equal(env.USERPROFILE, "C:\\Users\\patrick");
  assert.equal(env.MY_TOOLCHAIN_VAR, "keep-me");
  assert.equal(env.DC_REMOTE_DEVICE, "true");

  for (const key of [
    "EXECUTOR_CLIENT_TOKEN",
    "executor_device_token",
    "EXECUTOR_DEVICE_TOKENS_JSON",
    "EXECUTOR_TUNNEL_API_SECRET",
    "CONTROL_PLANE_API_KEY",
    "CONTROL_PLANE_TUNNEL_ID",
    "MCP_EXTRA_HEADERS",
    "OPENAI_TUNNEL_RUNTIME_API_KEY",
    "OPENAI_MCP_TUNNEL_ID",
    "HEALTH_URL_FILE"
  ]) {
    assert.equal(key in env, false, key);
  }
});

test("payload environment removes Node preload/injection settings that would weaken pinned-payload identity", () => {
  const env = payloadEnvironment({
    PATH: "keep",
    NODE_OPTIONS: "--require C:\\temp\\inject.js",
    node_path: "C:\\temp\\modules",
    LD_PRELOAD: "/tmp/inject.so",
    DYLD_INSERT_LIBRARIES: "/tmp/inject.dylib"
  });

  assert.equal(env.PATH, "keep");
  assert.equal("NODE_OPTIONS" in env, false);
  assert.equal("node_path" in env, false);
  assert.equal("LD_PRELOAD" in env, false);
  assert.equal("DYLD_INSERT_LIBRARIES" in env, false);
});


test("payload environment strips cross-runtime startup injection hooks", () => {
  const env = payloadEnvironment({
    PATH: "keep",
    PYTHONPATH: "/tmp/untrusted",
    pythonhome: "/tmp/python-root",
    BASH_ENV: "/tmp/inject.sh",
    ENV: "/tmp/inject.sh",
    RUBYOPT: "-r/tmp/inject.rb",
    PERL5OPT: "-MUntrusted",
    MY_SAFE_CUSTOM_VAR: "keep-me"
  });
  assert.equal(env.PATH, "keep");
  assert.equal(env.MY_SAFE_CUSTOM_VAR, "keep-me");
  for (const key of ["PYTHONPATH", "pythonhome", "BASH_ENV", "ENV", "RUBYOPT", "PERL5OPT"]) {
    assert.equal(key in env, false, key);
  }
});
