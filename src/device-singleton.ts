import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";

/** One canonical key for the installed launcher and a direct device-agent CLI. */
export function deviceSingletonIdentifier(serviceUrl: string, deviceId: string): string {
  const route = new URL(serviceUrl);
  // The device agent replaces any supplied input path with /device before
  // connecting. Payload roots and input paths can change without changing the
  // actual service/device identity, so neither belongs in the key.
  // Auth tokens and the server registry use exact-case device IDs. Keep their
  // semantics here: "Lappy" and "lappy" can be distinct registered devices.
  const material = JSON.stringify([route.origin, deviceId]);
  return createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, 32);
}

/**
 * A process-lifetime device lease. Unlike a wrapper-owned mutex or PID file, the
 * endpoint disappears when the owning Node process exits, including on crash.
 * Windows named pipes are machine-wide rather than bound to a logon session;
 * Linux abstract sockets avoid stale filesystem socket paths.
 */
export async function acquireDeviceSingleton(identifier: string): Promise<Server> {
  if (!/^[a-f0-9]{32}$/i.test(identifier)) throw new Error("invalid Executor device singleton identifier");
  if (process.platform !== "win32" && process.platform !== "linux") {
    throw new Error("Executor device singleton unsupported on this platform");
  }

  const address = process.platform === "win32"
    ? `\\\\.\\pipe\\ExecutorDevice-${identifier.toLowerCase()}`
    : `\0ExecutorDevice-${identifier.toLowerCase()}`;
  const server = createServer(socket => socket.destroy());

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(address, () => {
        server.off("error", onError);
        resolve();
      });
    });
    return server;
  } catch (error) {
    server.close();
    throw error;
  }
}
