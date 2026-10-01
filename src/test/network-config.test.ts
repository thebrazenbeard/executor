import test from "node:test";
import assert from "node:assert/strict";
import { serverBindConfig } from "../config.js";

test("Executor binds to loopback unless the operator explicitly overrides it", () => {
  assert.deepEqual(serverBindConfig({}), { host: "127.0.0.1", port: 8787 });
});

test("Executor honors an explicit service bind override", () => {
  assert.deepEqual(serverBindConfig({ HOST: "0.0.0.0", PORT: "9000" }), { host: "0.0.0.0", port: 9000 });
});
