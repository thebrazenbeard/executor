import type { JsonRpc } from "./protocol.js";

export const executorListDevicesTool = {
  name: "list_devices",
  description: "List workstations currently connected to Executor.",
  inputSchema: {
    type: "object",
    properties: {}
  }
} as const;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function extractDeviceId(payload: JsonRpc): string | undefined {
  if (payload.method !== "tools/call" || !object(payload.params)) return undefined;
  const args = payload.params.arguments;
  if (!object(args)) return undefined;
  return typeof args.deviceId === "string" && args.deviceId.length > 0 ? args.deviceId : undefined;
}

export function stripDeviceId(payload: JsonRpc): JsonRpc {
  if (payload.method !== "tools/call" || !object(payload.params)) return payload;
  const args = payload.params.arguments;
  if (!object(args) || !("deviceId" in args)) return payload;
  const { deviceId: _deviceId, ...forwardedArguments } = args;
  return {
    ...payload,
    params: {
      ...payload.params,
      arguments: forwardedArguments
    }
  };
}

export function augmentToolsList(response: JsonRpc): JsonRpc {
  if (!object(response.result) || !Array.isArray(response.result.tools)) return response;

  const tools = response.result.tools.map(tool => {
    if (!object(tool)) return tool;
    const schema = object(tool.inputSchema) ? tool.inputSchema : { type: "object" };
    const properties = object(schema.properties) ? schema.properties : {};
    return {
      ...tool,
      inputSchema: {
        ...schema,
        type: "object",
        properties: {
          ...properties,
          deviceId: {
            type: "string",
            description: "Optional Executor workstation ID. Omit to use the configured/default connected device."
          }
        }
      }
    };
  });

  if (!tools.some(tool => object(tool) && tool.name === executorListDevicesTool.name)) {
    tools.push(executorListDevicesTool);
  }

  return {
    ...response,
    result: {
      ...response.result,
      tools
    }
  };
}
