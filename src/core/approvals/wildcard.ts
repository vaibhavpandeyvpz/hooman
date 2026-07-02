/**
 * Minimal wildcard matcher used by the approval allowlist.
 *
 * Ported from the opencode/kilocode permission engines:
 * - `*` matches zero or more characters
 * - `?` matches exactly one character
 * - a trailing " *" is relaxed to "( .*)?" so a pattern like `git *` also
 *   matches the bare `git` command (arguments become optional)
 *
 * Matching is anchored (`^...$`) and treats the input as a single line so `*`
 * spans newlines. Backslashes are normalized to forward slashes so path
 * patterns behave the same on Windows.
 */
export function matchWildcard(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/");
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  if (escaped.endsWith(" .*")) {
    escaped = `${escaped.slice(0, -3)}( .*)?`;
  }

  const flags = process.platform === "win32" ? "si" : "s";
  return new RegExp(`^${escaped}$`, flags).test(normalized);
}
