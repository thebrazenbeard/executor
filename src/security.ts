import path from "node:path";

export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes("*") || allowed.includes(origin);
}

export function assertSafeDeviceServiceUrl(url: URL): void {
  if (url.protocol === "https:") return;
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (!loopback) throw new Error("device service URL requires TLS except on loopback");
}

export function resolveInsideRoot(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error("manifest path must be relative");
  const base = path.resolve(root);
  const resolved = path.resolve(base, relative);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("manifest path escapes install root");
  return resolved;
}

export function trustedSha256Matches(actual: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/i.test(expected) && actual.toLowerCase() === expected.toLowerCase();
}
