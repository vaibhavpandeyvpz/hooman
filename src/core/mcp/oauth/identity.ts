import { createHash } from "node:crypto";
import type { Sse, StreamableHttp } from "../types.js";

export type OAuthRemoteTransport = StreamableHttp | Sse;

export function canonicalizeRemoteServerUrl(input: string | URL): string {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  }
  return url.toString();
}

export function createRemoteTransportFingerprint(
  name: string,
  transport: OAuthRemoteTransport,
): string {
  const payload = JSON.stringify({
    name,
    type: transport.type,
    url: canonicalizeRemoteServerUrl(transport.url),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function createRemoteTransportIdentity(
  name: string,
  transport: OAuthRemoteTransport,
): {
  key: string;
  serverName: string;
  serverUrl: string;
} {
  return {
    key: createRemoteTransportFingerprint(name, transport),
    serverName: name,
    serverUrl: canonicalizeRemoteServerUrl(transport.url),
  };
}
