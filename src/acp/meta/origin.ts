import type { ChannelOrigin } from "../../core/approvals/channel-ask.js";

const MAX_FIELD_LEN = 256;

function sanitize(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const t = raw
    .trim()
    .slice(0, MAX_FIELD_LEN)
    .replace(/[\u0000-\u001F\u007F]/g, "");
  return t.length > 0 ? t : undefined;
}

/**
 * Daemon-originated channel context from ACP `_meta["hooman/origin"]` on
 * `session/prompt`. Refreshed on every turn (unlike the session's stable
 * `userId`) because the reply target/thread can change between turns while
 * the ACP session — the logical conversation — stays the same.
 */
export function extractAcpPromptOrigin(
  _meta: unknown,
): ChannelOrigin | undefined {
  if (!_meta || typeof _meta !== "object") {
    return undefined;
  }
  const raw = (_meta as Record<string, unknown>)["hooman/origin"];
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const entry = raw as Record<string, unknown>;
  const origin: ChannelOrigin = {
    server: sanitize(entry.server),
    source: sanitize(entry.source),
    user: sanitize(entry.user),
    session: sanitize(entry.session),
    thread: sanitize(entry.thread),
  };
  return Object.values(origin).some((value) => value !== undefined)
    ? origin
    : undefined;
}
