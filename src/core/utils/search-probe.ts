/**
 * Lightweight credential probe for search providers (one-result test query).
 * Kept free of the web_search tool / Strands SDK so the VS Code extension can
 * import it without pulling those into the extension host bundle.
 */

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SERPER_ENDPOINT = "https://google.serper.dev/search";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const EXA_ENDPOINT = "https://api.exa.ai/search";
const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/search";
const DEFAULT_TIMEOUT_MS = 20_000;
const FIRECRAWL_TIMEOUT_MS = 60_000;
const PROBE_QUERY = "hooman";

export type SearchProbeProvider =
  | "brave"
  | "duckduckgo"
  | "exa"
  | "firecrawl"
  | "litellm"
  | "serper"
  | "tavily";

export type SearchProbeOptions = {
  provider: SearchProbeProvider;
  apiKey?: string;
  baseURL?: string;
  /** LiteLLM search tool id (e.g. `perplexity-search`). */
  tool?: string;
  signal?: AbortSignal;
};

/**
 * Run a one-result test search to validate search provider credentials.
 * DuckDuckGo has no API key and succeeds without a network call.
 */
export async function probeSearchProvider(
  options: SearchProbeOptions,
): Promise<void> {
  if (options.provider === "duckduckgo") {
    return;
  }

  const timeoutMs =
    options.provider === "firecrawl" || options.provider === "litellm"
      ? FIRECRAWL_TIMEOUT_MS
      : DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([timeoutSignal, options.signal])
    : timeoutSignal;

  switch (options.provider) {
    case "brave":
      await probeBrave(requireApiKey(options.apiKey), signal);
      return;
    case "exa":
      await probeExa(requireApiKey(options.apiKey), signal);
      return;
    case "firecrawl":
      await probeFirecrawl(requireApiKey(options.apiKey), signal);
      return;
    case "litellm":
      await probeLiteLLM(
        {
          baseURL: requireValue(options.baseURL, "Base URL is required."),
          apiKey: requireApiKey(options.apiKey),
          tool: requireValue(options.tool, "Search tool is required."),
        },
        signal,
      );
      return;
    case "serper":
      await probeSerper(requireApiKey(options.apiKey), signal);
      return;
    case "tavily":
      await probeTavily(requireApiKey(options.apiKey), signal);
      return;
    default: {
      const _exhaustive: never = options.provider;
      throw new Error(`Unsupported search provider: ${_exhaustive}`);
    }
  }
}

function requireApiKey(apiKey: string | undefined): string {
  return requireValue(apiKey, "API key is required.");
}

function requireValue(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}

async function readErrorBody(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body.slice(0, 200);
}

async function probeBrave(apiKey: string, signal: AbortSignal): Promise<void> {
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", PROBE_QUERY);
  url.searchParams.set("count", "1");
  const response = await fetch(url, {
    method: "GET",
    signal,
    headers: {
      accept: "application/json",
      "x-subscription-token": apiKey,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Brave search failed (${response.status}): ${await readErrorBody(response)}`,
    );
  }
}

async function probeSerper(apiKey: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: PROBE_QUERY, num: 1 }),
  });
  if (!response.ok) {
    throw new Error(
      `Serper search failed (${response.status}): ${await readErrorBody(response)}`,
    );
  }
}

async function probeTavily(apiKey: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: PROBE_QUERY,
      max_results: 1,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Tavily search failed (${response.status}): ${await readErrorBody(response)}`,
    );
  }
}

async function probeExa(apiKey: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(EXA_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: PROBE_QUERY,
      numResults: 1,
      type: "auto",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Exa search failed (${response.status}): ${await readErrorBody(response)}`,
    );
  }
}

async function probeFirecrawl(
  apiKey: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(FIRECRAWL_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: PROBE_QUERY, limit: 1 }),
  });
  if (!response.ok) {
    throw new Error(
      `Firecrawl search failed (${response.status}): ${await readErrorBody(response)}`,
    );
  }
}

async function probeLiteLLM(
  options: { baseURL: string; apiKey: string; tool: string },
  signal: AbortSignal,
): Promise<void> {
  const base = options.baseURL.replace(/\/+$/, "");
  const url = `${base}/v1/search/${encodeURIComponent(options.tool)}`;
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({ query: PROBE_QUERY, max_results: 1 }),
  });
  if (!response.ok) {
    throw new Error(
      `LiteLLM search failed (${response.status}): ${await readErrorBody(response)}`,
    );
  }
}
