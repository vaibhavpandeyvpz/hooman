const MAX_USER_ID_LEN = 256;

function sanitizeClientUserId(raw: string): string {
  const t = raw.trim().slice(0, MAX_USER_ID_LEN);
  if (!t) {
    return "";
  }
  return t.replace(/[\u0000-\u001F\u007F]/g, "");
}

/**
 * Logical user id from ACP `_meta` on `session/new` and `session/load`.
 *
 * Resolution order (first non-empty wins):
 * - `_meta["hoomanity/userId"]` (string)
 * - `_meta.hoomanity.userId` (string)
 * - `_meta.userId` (string)
 *
 * Values are trimmed, capped in length, and stripped of ASCII control characters.
 * Empty after sanitization is treated as absent.
 */
export function extractAcpClientUserId(_meta: unknown): string | undefined {
  if (!_meta || typeof _meta !== "object") {
    return undefined;
  }
  const m = _meta as Record<string, unknown>;
  const candidates: unknown[] = [
    m["hoomanity/userId"],
    m.hoomanity !== null &&
    typeof m.hoomanity === "object" &&
    "userId" in m.hoomanity
      ? (m.hoomanity as Record<string, unknown>).userId
      : undefined,
    m.userId,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") {
      continue;
    }
    const s = sanitizeClientUserId(c);
    if (s) {
      return s;
    }
  }
  return undefined;
}
