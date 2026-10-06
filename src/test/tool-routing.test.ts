import test from "node:test";
import assert from "node:assert/strict";
import {
  augmentToolsList,
  extractDeviceId,
  stripDeviceId,
  executorListDevicesTool
} from "../tool-routing.js";

test("Executor adds optional deviceId to workstation tools and publishes list_devices", () => {
  const response = {
    jsonrpc: "2.0" as const,
    id: 1,
    result: {
      tools: [{
        name: "start_process",
        description: "run a command",
        inputSchema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"]
        }
      }]
    }
  };

  const augmented = augmentToolsList(response);
  const tools = (augmented.result as any).tools;
  const start = tools.find((tool: any) => tool.name === "start_process");
  assert.equal(start.inputSchema.properties.deviceId.type, "string");
  assert.deepEqual(start.inputSchema.required, ["command"]);
  assert.equal(tools.some((tool: any) => tool.name === executorListDevicesTool.name), true);
});

test("deviceId routes at Executor and is removed before downstream dispatch", () => {
  const payload = {
    jsonrpc: "2.0" as const,
    id: 7,
    method: "tools/call",
    params: {
      name: "start_process",
      arguments: { command: "echo ok", deviceId: "lappy" }
    }
  };

  assert.equal(extractDeviceId(payload), "lappy");
  assert.deepEqual((stripDeviceId(payload).params as any).arguments, { command: "echo ok" });
});
