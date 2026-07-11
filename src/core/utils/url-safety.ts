import dns from "node:dns/promises";
import net from "node:net";

export function isHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  return url;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

function isPrivateIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;

    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

export async function assertRemoteUrl(url: URL): Promise<void> {
  if (isPrivateHostname(url.hostname)) {
    throw new Error("Fetching localhost or loopback URLs is not allowed.");
  }

  const resolved = await dns.lookup(url.hostname, { all: true });
  if (resolved.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Fetching private-network URLs is not allowed.");
  }
}
