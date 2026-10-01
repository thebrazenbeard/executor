import { timingSafeEqual } from "node:crypto";

function equalSecret(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function bearerAuthorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return equalSecret(header.slice(7), expected);
}

export function tokenAuthorized(actual: string, expected: string): boolean {
  return equalSecret(actual, expected);
}
