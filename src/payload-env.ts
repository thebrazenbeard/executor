const BLOCKED_PAYLOAD_ENV = new Set([
  "CONTROL_PLANE_API_KEY",
  "CONTROL_PLANE_TUNNEL_ID",
  "MCP_EXTRA_HEADERS",
  "HEALTH_URL_FILE",
  "OPENAI_MCP_TUNNEL_ID",
  "OPENAI_TUNNEL_RUNTIME_API_KEY",
  // A qualified payload runs with the workstation user's authority. These
  // protections reduce incidental credential and unsafe TLS inheritance;
  // they are not an OS security boundary against that payload.
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH"
]);

export function payloadEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const normalized = key.toUpperCase();
    if (normalized.startsWith("EXECUTOR_")) continue;
    if (BLOCKED_PAYLOAD_ENV.has(normalized)) continue;
    env[key] = value;
  }

  env.DC_REMOTE_DEVICE = "true";
  return env;
}
