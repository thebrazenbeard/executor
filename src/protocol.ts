export type JsonRpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type DeviceHello = {
  type: "hello";
  deviceId: string;
  token: string;
  initializeResult?: Record<string, unknown>;
};

export type DeviceRequest = {
  type: "request";
  requestId: string;
  payload: JsonRpc;
};

export type DeviceResponse = {
  type: "response";
  requestId: string;
  payload: JsonRpc;
};

export type WireMessage = DeviceHello | DeviceRequest | DeviceResponse;

export function isJsonRpc(value: unknown): value is JsonRpc {
  return !!value && typeof value === "object" && (value as JsonRpc).jsonrpc === "2.0";
}

export function isNotification(value: JsonRpc): boolean {
  return typeof value.method === "string" && value.id === undefined;
}
