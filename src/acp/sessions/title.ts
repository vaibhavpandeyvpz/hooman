export const MAX_SESSION_TITLE_LEN = 80;

/**
 * Derive a session list title from the first user-visible line of a prompt echo.
 */
export function deriveSessionTitleFromEcho(echo: string): string | null {
  const line = echo
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!line) {
    return null;
  }
  const collapsed = line.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }
  if (collapsed.length <= MAX_SESSION_TITLE_LEN) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_SESSION_TITLE_LEN - 1)}…`;
}
