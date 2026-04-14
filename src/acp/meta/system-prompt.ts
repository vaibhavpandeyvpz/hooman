const MAX_SYSTEM_PROMPT_LEN = 32_000;

function sanitizeClientSystemPrompt(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim().slice(0, MAX_SYSTEM_PROMPT_LEN);
}

/**
 * Session-level system prompt override from ACP `_meta` on `session/new` and `session/load`.
 *
 * Resolution order (first non-empty wins):
 * - `_meta["hoomanity/systemPrompt"]` (string)
 * - `_meta.hoomanity.systemPrompt` (string)
 * - `_meta.systemPrompt` (string)
 *
 * Values are normalized to `\n`, trimmed, and capped in length.
 * Empty after sanitization is treated as absent.
 */
export function extractAcpClientSystemPrompt(
  _meta: unknown,
): string | undefined {
  if (!_meta || typeof _meta !== "object") {
    return undefined;
  }
  const m = _meta as Record<string, unknown>;
  const candidates: unknown[] = [
    m["hoomanity/systemPrompt"],
    m.hoomanity !== null &&
    typeof m.hoomanity === "object" &&
    "systemPrompt" in m.hoomanity
      ? (m.hoomanity as Record<string, unknown>).systemPrompt
      : undefined,
    m.systemPrompt,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") {
      continue;
    }
    const s = sanitizeClientSystemPrompt(c);
    if (s) {
      return s;
    }
  }
  return undefined;
}
