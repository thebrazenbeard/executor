export function extractTryCloudflareUrl(log: string): string | undefined {
  const candidates = log.match(/https:\/\/[^\s|"'<>]+/gi) ?? [];
  for (const raw of candidates) {
    const cleaned = raw.replace(/[),.;]+$/g, "");
    let url: URL;
    try { url = new URL(cleaned); } catch { continue; }
    if (url.protocol !== "https:") continue;
    if (url.username || url.password) continue;
    if (!url.hostname.endsWith(".trycloudflare.com")) continue;
    if (url.hostname === "trycloudflare.com") continue;
    if (url.port) continue;
    return url.origin;
  }
  return undefined;
}
