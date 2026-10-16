import dgram from "node:dgram";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAT_PMP_PORT = 5351;
const OPCODES = { udp: 1, tcp: 2 };

function u16(buffer, offset) {
  return buffer.readUInt16BE(offset);
}

function u32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

export function buildMapRequest(protocol, internalPort, externalPort, lifetimeSeconds) {
  const opcode = OPCODES[String(protocol).toLowerCase()];
  if (!opcode) throw new Error("protocol must be tcp or udp");
  for (const [name, value] of Object.entries({ internalPort, externalPort })) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be 1..65535`);
  }
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 0 || lifetimeSeconds > 0xffffffff) {
    throw new Error("lifetimeSeconds must be 0..4294967295");
  }

  const request = Buffer.alloc(12);
  request[0] = 0;
  request[1] = opcode;
  request.writeUInt16BE(internalPort, 4);
  request.writeUInt16BE(externalPort, 6);
  request.writeUInt32BE(lifetimeSeconds >>> 0, 8);
  return request;
}

export function parseMapResponse(buffer, protocol) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) throw new Error("invalid NAT-PMP mapping response");
  const opcode = OPCODES[String(protocol).toLowerCase()];
  if (!opcode) throw new Error("protocol must be tcp or udp");
  const parsed = {
    version: buffer[0],
    opcode: buffer[1],
    resultCode: u16(buffer, 2),
    epochSeconds: u32(buffer, 4),
    internalPort: u16(buffer, 8),
    externalPort: u16(buffer, 10),
    lifetimeSeconds: u32(buffer, 12)
  };
  if (parsed.version !== 0 || parsed.opcode !== opcode + 128) throw new Error("unexpected NAT-PMP mapping response");
  return parsed;
}

export function buildPublicAddressRequest() {
  return Buffer.from([0, 0]);
}

export function parsePublicAddressResponse(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) throw new Error("invalid NAT-PMP public-address response");
  if (buffer[0] !== 0 || buffer[1] !== 128) throw new Error("unexpected NAT-PMP public-address response");
  return {
    version: buffer[0],
    opcode: buffer[1],
    resultCode: u16(buffer, 2),
    epochSeconds: u32(buffer, 4),
    publicIp: `${buffer[8]}.${buffer[9]}.${buffer[10]}.${buffer[11]}`
  };
}

async function sendRequest(gateway, payload, timeoutMs = 3000) {
  return await new Promise((resolvePromise, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("NAT-PMP request timed out"));
    }, timeoutMs);

    const finish = (fn, value) => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      fn(value);
    };

    socket.once("error", error => finish(reject, error));
    socket.once("message", message => finish(resolvePromise, message));
    socket.send(payload, NAT_PMP_PORT, gateway, error => {
      if (error) finish(reject, error);
    });
  });
}

export async function requestMapping({ gateway, protocol = "tcp", internalPort, externalPort, lifetimeSeconds, timeoutMs = 3000 }) {
  const response = parseMapResponse(
    await sendRequest(gateway, buildMapRequest(protocol, internalPort, externalPort, lifetimeSeconds), timeoutMs),
    protocol
  );
  if (response.resultCode !== 0) throw new Error(`NAT-PMP router returned result code ${response.resultCode}`);
  if (response.internalPort !== internalPort) throw new Error("NAT-PMP router returned a different internal port");
  if (lifetimeSeconds > 0 && response.externalPort !== externalPort) {
    try {
      await sendRequest(gateway, buildMapRequest(protocol, internalPort, 0, 0), timeoutMs);
    } catch {}
    throw new Error(`NAT-PMP router mapped external port ${response.externalPort}, expected ${externalPort}`);
  }
  return response;
}

export async function requestPublicAddress(gateway, timeoutMs = 3000) {
  const response = parsePublicAddressResponse(await sendRequest(gateway, buildPublicAddressRequest(), timeoutMs));
  if (response.resultCode !== 0) throw new Error(`NAT-PMP router returned result code ${response.resultCode}`);
  return response;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const value = argv[++i];
    if (value === undefined) throw new Error(`missing value for --${key}`);
    args[key] = value;
  }
  return args;
}

function numberArg(args, key, fallback) {
  const raw = args[key];
  if (raw === undefined && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`--${key} must be an integer`);
  return value;
}

async function lease(args) {
  const gateway = args.gateway;
  const protocol = (args.protocol ?? "tcp").toLowerCase();
  const internalPort = numberArg(args, "internal-port");
  const externalPort = numberArg(args, "external-port");
  const requestedLifetime = numberArg(args, "lifetime", 3600);
  const readyFile = args["ready-file"];

  if (!gateway) throw new Error("--gateway is required");

  let stopped = false;
  let currentLifetime = requestedLifetime;
  const stop = () => { stopped = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  async function renew() {
    const mapped = await requestMapping({
      gateway,
      protocol,
      internalPort,
      externalPort,
      lifetimeSeconds: requestedLifetime
    });
    currentLifetime = mapped.lifetimeSeconds || requestedLifetime;
    return mapped;
  }

  const initial = await renew();
  const initialState = { status: "mapped", gateway, protocol, ...initial };
  if (readyFile) await writeFile(readyFile, JSON.stringify(initialState), "utf8");
  process.stdout.write(JSON.stringify(initialState) + "\n");

  let delayMs = Math.max(30_000, Math.floor(currentLifetime * 500));
  while (!stopped) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, delayMs));
    if (stopped) break;
    try {
      const renewed = await renew();
      process.stdout.write(JSON.stringify({ status: "renewed", gateway, protocol, ...renewed }) + "\n");
      delayMs = Math.max(30_000, Math.floor(currentLifetime * 500));
    } catch (error) {
      process.stderr.write(`NAT-PMP renewal failed: ${error instanceof Error ? error.message : String(error)}\n`);
      delayMs = 10_000;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command) throw new Error("command is required: public-address | map | delete | lease");

  if (command === "public-address") {
    if (!args.gateway) throw new Error("--gateway is required");
    console.log(JSON.stringify(await requestPublicAddress(args.gateway)));
    return;
  }

  if (command === "map" || command === "delete") {
    if (!args.gateway) throw new Error("--gateway is required");
    const protocol = (args.protocol ?? "tcp").toLowerCase();
    const internalPort = numberArg(args, "internal-port");
    const externalPort = command === "delete" ? 0 : numberArg(args, "external-port");
    const lifetimeSeconds = command === "delete" ? 0 : numberArg(args, "lifetime", 3600);
    console.log(JSON.stringify(await requestMapping({
      gateway: args.gateway,
      protocol,
      internalPort,
      externalPort,
      lifetimeSeconds
    })));
    return;
  }

  if (command === "lease") {
    await lease(args);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}