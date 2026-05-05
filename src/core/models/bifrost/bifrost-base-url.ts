/**
 * Bifrost serves the OpenAI-compatible API under `/openai/v1/...`. The OpenAI client expects
 * `baseURL` to include the `/v1` prefix. Users may set only the gateway origin (e.g.
 * `http://localhost:8080`); we append `/openai/v1` in that case.
 */
export function normalizeBifrostClientBaseURL(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return raw;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    return `${url.origin}/openai/v1`;
  }
  if (path.endsWith("/openai/v1")) {
    return `${url.origin}${path}`;
  }
  if (path === "/openai" || path.endsWith("/openai")) {
    return `${url.origin}${path}/v1`;
  }
  return trimmed;
}
