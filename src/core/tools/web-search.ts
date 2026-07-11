import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import Firecrawl from "@mendable/firecrawl-js";
import * as cheerio from "cheerio";
import { Exa } from "exa-js";
import { tavily } from "@tavily/core";
import { z } from "zod";
import type { Config } from "../config.js";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DUCKDUCKGO_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const SERPER_ENDPOINT = "https://google.serper.dev/search";
const DEFAULT_TIMEOUT_SECONDS = 20;
/** Firecrawl search+scrape can exceed the default web search timeout. */
const FIRECRAWL_SEARCH_TIMEOUT_SECONDS = 60;
const FIRECRAWL_SNIPPET_MAX_CHARS = 1200;
const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 20;
const DUCKDUCKGO_USER_AGENT =
  "Mozilla/5.0 (compatible; Hooman/1.0; +https://github.com/vaibhavpandeyvpz/hooman)";

/** Maps ISO 3166-1 alpha-2 country codes to DuckDuckGo `kl` region values. */
const DUCKDUCKGO_REGION_BY_COUNTRY: Record<string, string> = {
  ar: "ar-es",
  at: "at-de",
  au: "au-en",
  be: "be-nl",
  bg: "bg-bg",
  br: "br-pt",
  ca: "ca-en",
  ch: "ch-de",
  cl: "cl-es",
  cn: "cn-zh",
  co: "co-es",
  cz: "cz-cs",
  de: "de-de",
  dk: "dk-da",
  ee: "ee-et",
  es: "es-es",
  fi: "fi-fi",
  fr: "fr-fr",
  gb: "uk-en",
  gr: "gr-el",
  hk: "hk-tzh",
  hr: "hr-hr",
  hu: "hu-hu",
  id: "id-en",
  ie: "ie-en",
  il: "il-en",
  in: "in-en",
  is: "is-is",
  it: "it-it",
  jp: "jp-jp",
  kr: "kr-kr",
  lt: "lt-lt",
  lv: "lv-lv",
  mx: "mx-es",
  my: "my-en",
  nl: "nl-nl",
  no: "no-no",
  nz: "nz-en",
  pe: "pe-es",
  ph: "ph-en",
  pk: "pk-en",
  pl: "pl-pl",
  pt: "pt-pt",
  ro: "ro-ro",
  ru: "ru-ru",
  se: "se-sv",
  sg: "sg-en",
  sk: "sk-sk",
  sl: "sl-sl",
  th: "th-en",
  tr: "tr-tr",
  tw: "tw-tzh",
  ua: "ua-uk",
  uk: "uk-en",
  us: "us-en",
  vn: "vn-en",
  za: "za-en",
};

/** Reject when `signal` aborts (SDK calls do not accept AbortSignal). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("The operation was aborted.", "AbortError"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

const FreshnessSchema = z.enum(["day", "week", "month", "year"]);

const InputSchema = z
  .object({
    query: z.string().min(1).max(400),
    count: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_RESULT_COUNT)
      .default(DEFAULT_RESULT_COUNT),
    freshness: FreshnessSchema.optional(),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    country: z
      .string()
      .regex(/^[a-z]{2}$/i)
      .optional(),
    safe_search: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    const hasStartDate = Boolean(input.start_date);
    const hasEndDate = Boolean(input.end_date);
    if (hasStartDate !== hasEndDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "start_date and end_date must be provided together.",
      });
    }
    if (hasStartDate && input.freshness) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Use either freshness or start_date/end_date, not both together.",
      });
    }
  });

type WebSearchInput = z.infer<typeof InputSchema>;

type NormalizedResult = {
  title: string;
  url: string;
  snippet: string;
};

type NormalizedOutput = {
  provider:
    | "brave"
    | "duckduckgo"
    | "exa"
    | "firecrawl"
    | "litellm"
    | "serper"
    | "tavily";
  query: string;
  results: NormalizedResult[];
  metadata: {
    count: number;
    freshness: WebSearchInput["freshness"] | null;
    start_date: string | null;
    end_date: string | null;
    country: string | null;
    safe_search: boolean | null;
    returned_results: number;
  };
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function toBraveFreshness(input: WebSearchInput): string | undefined {
  if (input.start_date && input.end_date) {
    return `${input.start_date}to${input.end_date}`;
  }
  switch (input.freshness) {
    case "day":
      return "pd";
    case "week":
      return "pw";
    case "month":
      return "pm";
    case "year":
      return "py";
    default:
      return undefined;
  }
}

function toSerperTbs(input: WebSearchInput): string | undefined {
  if (input.start_date && input.end_date) {
    const start = formatSerperDate(input.start_date);
    const end = formatSerperDate(input.end_date);
    return `cdr:1,cd_min:${start},cd_max:${end}`;
  }
  switch (input.freshness) {
    case "day":
      return "qdr:d";
    case "week":
      return "qdr:w";
    case "month":
      return "qdr:m";
    case "year":
      return "qdr:y";
    default:
      return undefined;
  }
}

function formatSerperDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${month}/${day}/${year}`;
}

function toIsoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Maps freshness or explicit YYYY-MM-DD range to Exa `startPublishedDate` / `endPublishedDate` (date-only ISO). */
function exaPublishedRange(input: WebSearchInput): {
  startPublishedDate?: string;
  endPublishedDate?: string;
} {
  if (input.start_date && input.end_date) {
    return {
      startPublishedDate: input.start_date,
      endPublishedDate: input.end_date,
    };
  }
  if (!input.freshness) {
    return {};
  }
  const end = new Date();
  const start = new Date(end);
  switch (input.freshness) {
    case "day":
      start.setUTCDate(start.getUTCDate() - 1);
      break;
    case "week":
      start.setUTCDate(start.getUTCDate() - 7);
      break;
    case "month":
      start.setUTCMonth(start.getUTCMonth() - 1);
      break;
    case "year":
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      break;
    default:
      break;
  }
  return {
    startPublishedDate: toIsoDateUtc(start),
    endPublishedDate: toIsoDateUtc(end),
  };
}

function tavilyCountryCode(code: string | undefined): string | undefined {
  if (!code) {
    return undefined;
  }
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" }).of(
      code.toUpperCase(),
    );
    if (!display) {
      return undefined;
    }
    return display.toLowerCase();
  } catch {
    return undefined;
  }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncateSnippet(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) {
    return t;
  }
  return `${t.slice(0, maxChars).trimEnd()}…`;
}

function normalizeBraveResults(payload: unknown): NormalizedResult[] {
  const root = payload as {
    web?: { results?: Array<Record<string, unknown>> };
  };
  const results = root.web?.results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map((item) => ({
      title: cleanString(item.title),
      url: cleanString(item.url),
      snippet: cleanString(item.description),
    }))
    .filter((item) => item.url.length > 0);
}

function normalizeTavilyResults(payload: unknown): NormalizedResult[] {
  const root = payload as { results?: Array<Record<string, unknown>> };
  if (!Array.isArray(root.results)) {
    return [];
  }
  return root.results
    .map((item) => ({
      title: cleanString(item.title),
      url: cleanString(item.url),
      snippet: cleanString(item.content),
    }))
    .filter((item) => item.url.length > 0);
}

function normalizeSerperResults(payload: unknown): NormalizedResult[] {
  const root = payload as { organic?: Array<Record<string, unknown>> };
  if (!Array.isArray(root.organic)) {
    return [];
  }
  return root.organic
    .map((item) => ({
      title: cleanString(item.title),
      url: cleanString(item.link),
      snippet: cleanString(item.snippet),
    }))
    .filter((item) => item.url.length > 0);
}

function snippetFromExaHighlights(item: Record<string, unknown>): string {
  const highlights = item.highlights;
  if (Array.isArray(highlights) && highlights.length > 0) {
    return highlights
      .map((h) => cleanString(h))
      .filter((s) => s.length > 0)
      .join(" ");
  }
  return "";
}

function normalizeExaResults(payload: unknown): NormalizedResult[] {
  const root = payload as { results?: Array<Record<string, unknown>> };
  if (!Array.isArray(root.results)) {
    return [];
  }
  return root.results
    .map((item) => {
      const fromHighlights = snippetFromExaHighlights(item);
      const snippet =
        fromHighlights || cleanString(item.summary) || cleanString(item.text);
      return {
        title: cleanString(item.title),
        url: cleanString(item.url),
        snippet,
      };
    })
    .filter((item) => item.url.length > 0);
}

function normalizeFirecrawlResults(payload: unknown): NormalizedResult[] {
  const root = payload as { data?: { web?: Array<Record<string, unknown>> } };
  const web = root.data?.web;
  if (!Array.isArray(web)) {
    return [];
  }
  return web
    .map((item) => {
      const markdown = cleanString(item.markdown);
      const description = cleanString(item.description);
      const snippetSource = markdown || description;
      return {
        title: cleanString(item.title),
        url: cleanString(item.url),
        snippet: snippetSource
          ? truncateSnippet(snippetSource, FIRECRAWL_SNIPPET_MAX_CHARS)
          : "",
      };
    })
    .filter((item) => item.url.length > 0);
}

function normalizeLiteLLMResults(payload: unknown): NormalizedResult[] {
  const root = payload as { results?: Array<Record<string, unknown>> };
  if (!Array.isArray(root.results)) {
    return [];
  }
  return root.results
    .map((item) => ({
      title: cleanString(item.title),
      url: cleanString(item.url),
      snippet:
        cleanString(item.snippet) ||
        cleanString(item.content) ||
        cleanString(item.text),
    }))
    .filter((item) => item.url.length > 0);
}

function normalizedOutput(
  provider:
    | "brave"
    | "duckduckgo"
    | "exa"
    | "firecrawl"
    | "litellm"
    | "serper"
    | "tavily",
  input: WebSearchInput,
  results: NormalizedResult[],
): NormalizedOutput {
  return {
    provider,
    query: input.query,
    results,
    metadata: {
      count: input.count,
      freshness: input.freshness ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      country: input.country?.toUpperCase() ?? null,
      safe_search: input.safe_search ?? null,
      returned_results: results.length,
    },
  };
}

function toDuckDuckGoDf(
  freshness: WebSearchInput["freshness"],
): string | undefined {
  switch (freshness) {
    case "day":
      return "d";
    case "week":
      return "w";
    case "month":
      return "m";
    case "year":
      return "y";
    default:
      return undefined;
  }
}

function toDuckDuckGoRegion(country: string | undefined): string | undefined {
  if (!country) {
    return undefined;
  }
  return DUCKDUCKGO_REGION_BY_COUNTRY[country.toLowerCase()];
}

function resolveDuckDuckGoHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed, DUCKDUCKGO_HTML_ENDPOINT);
    if (url.pathname === "/l/" || url.pathname.startsWith("/l/")) {
      const target = url.searchParams.get("uddg");
      if (target) {
        return decodeURIComponent(target);
      }
    }
    return url.href;
  } catch {
    return trimmed;
  }
}

function normalizeDuckDuckGoHtml(
  html: string,
  count: number,
): NormalizedResult[] {
  const $ = cheerio.load(html);
  const results: NormalizedResult[] = [];
  const seen = new Set<string>();

  const pushResult = (title: string, url: string, snippet: string) => {
    if (!url || seen.has(url) || results.length >= count) {
      return;
    }
    seen.add(url);
    results.push({ title, url, snippet });
  };

  const zciLink = $(".zci__heading a").first();
  const zciHref = resolveDuckDuckGoHref(zciLink.attr("href") ?? "");
  if (zciHref) {
    const abstract = $("#zero_click_abstract")
      .clone()
      .find("a, img")
      .remove()
      .end()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    pushResult(
      cleanString(zciLink.text()) || "Instant answer",
      zciHref,
      abstract,
    );
  }

  $("#links .web-result").each((_, element) => {
    if (results.length >= count) {
      return false;
    }
    const row = $(element);
    if (row.hasClass("result--ad") || row.find(".result--ad").length > 0) {
      return;
    }
    const link = row.find("a.result__a").first();
    const url = resolveDuckDuckGoHref(link.attr("href") ?? "");
    if (!url) {
      return;
    }
    const title = cleanString(link.text());
    const snippet = cleanString(row.find("a.result__snippet").first().text());
    pushResult(title, url, snippet);
  });

  return results;
}

async function searchDuckDuckGo(
  input: WebSearchInput,
  signal: AbortSignal,
): Promise<NormalizedOutput> {
  const url = new URL(DUCKDUCKGO_HTML_ENDPOINT);
  url.searchParams.set("q", input.query);
  const df = toDuckDuckGoDf(input.freshness);
  if (df) {
    url.searchParams.set("df", df);
  }
  const kl = toDuckDuckGoRegion(input.country);
  if (kl) {
    url.searchParams.set("kl", kl);
  }
  if (input.safe_search !== undefined) {
    url.searchParams.set("kp", input.safe_search ? "1" : "-2");
  }

  const response = await fetch(url, {
    method: "GET",
    signal,
    headers: {
      accept: "text/html",
      "user-agent": DUCKDUCKGO_USER_AGENT,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `DuckDuckGo search failed (${response.status} ${response.statusText}): ${body.slice(0, 200)}`,
    );
  }
  return normalizedOutput(
    "duckduckgo",
    input,
    normalizeDuckDuckGoHtml(body, input.count),
  );
}

async function searchBrave(
  input: WebSearchInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<NormalizedOutput> {
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(input.count));
  if (input.country) {
    url.searchParams.set("country", input.country.toUpperCase());
  }
  const freshness = toBraveFreshness(input);
  if (freshness) {
    url.searchParams.set("freshness", freshness);
  }
  if (input.safe_search !== undefined) {
    url.searchParams.set("safesearch", input.safe_search ? "strict" : "off");
  }

  const response = await fetch(url, {
    method: "GET",
    signal,
    headers: {
      accept: "application/json",
      "x-subscription-token": apiKey,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Brave search failed (${response.status} ${response.statusText}): ${body}`,
    );
  }
  const parsed = JSON.parse(body) as unknown;
  return normalizedOutput("brave", input, normalizeBraveResults(parsed));
}

async function searchExa(
  input: WebSearchInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<NormalizedOutput> {
  const exa = new Exa(apiKey);
  const published = exaPublishedRange(input);
  const result = await abortable(
    exa.search(input.query, {
      type: "auto",
      numResults: input.count,
      contents: { highlights: true },
      ...(input.country ? { userLocation: input.country.toUpperCase() } : {}),
      ...(published.startPublishedDate
        ? { startPublishedDate: published.startPublishedDate }
        : {}),
      ...(published.endPublishedDate
        ? { endPublishedDate: published.endPublishedDate }
        : {}),
      ...(input.safe_search === true ? { moderation: true } : {}),
    }),
    signal,
  );
  return normalizedOutput("exa", input, normalizeExaResults(result));
}

async function searchFirecrawl(
  input: WebSearchInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<NormalizedOutput> {
  type FirecrawlSearchExtras = NonNullable<Parameters<Firecrawl["search"]>[1]>;
  const firecrawl = new Firecrawl({ apiKey });
  const tbs = toSerperTbs(input);
  const options: FirecrawlSearchExtras = {
    limit: input.count,
    scrapeOptions: { formats: ["markdown"] },
    timeout: FIRECRAWL_SEARCH_TIMEOUT_SECONDS * 1000,
    ...(tbs ? { tbs } : {}),
  };
  const data = await abortable(firecrawl.search(input.query, options), signal);
  return normalizedOutput(
    "firecrawl",
    input,
    normalizeFirecrawlResults({ data: { web: data.web } }),
  );
}

async function searchLiteLLM(
  input: WebSearchInput,
  options: { baseURL: string; apiKey: string; searchTool: string },
  signal: AbortSignal,
): Promise<NormalizedOutput> {
  const base = options.baseURL.replace(/\/+$/, "");
  const url = `${base}/v1/search/${encodeURIComponent(options.searchTool)}`;
  const payload: Record<string, unknown> = {
    query: input.query,
    max_results: input.count,
  };
  if (input.country) {
    payload.country = input.country.toUpperCase();
  }

  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `LiteLLM search failed (${response.status} ${response.statusText}): ${body}`,
    );
  }
  const parsed = JSON.parse(body) as unknown;
  return normalizedOutput("litellm", input, normalizeLiteLLMResults(parsed));
}

async function searchSerper(
  input: WebSearchInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<NormalizedOutput> {
  const payload: Record<string, unknown> = {
    q: input.query,
    num: input.count,
  };
  if (input.country) {
    payload.gl = input.country.toLowerCase();
  }
  const tbs = toSerperTbs(input);
  if (tbs) {
    payload.tbs = tbs;
  }
  if (input.safe_search !== undefined) {
    payload.safe = input.safe_search ? "active" : "off";
  }

  const response = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Serper search failed (${response.status} ${response.statusText}): ${body}`,
    );
  }
  const parsed = JSON.parse(body) as unknown;
  return normalizedOutput("serper", input, normalizeSerperResults(parsed));
}

async function searchTavily(
  input: WebSearchInput,
  apiKey: string,
): Promise<NormalizedOutput> {
  const client = tavily({ apiKey }) as {
    search: (
      query: string,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  const options: Record<string, unknown> = {
    max_results: input.count,
  };
  if (input.country) {
    const mappedCountry = tavilyCountryCode(input.country);
    if (mappedCountry) {
      options.country = mappedCountry;
    }
  }
  if (input.start_date && input.end_date) {
    options.start_date = input.start_date;
    options.end_date = input.end_date;
  } else if (input.freshness) {
    options.time_range = input.freshness;
  }
  if (input.safe_search !== undefined) {
    options.safe_search = input.safe_search;
  }

  const response = await client.search(input.query, options);
  return normalizedOutput("tavily", input, normalizeTavilyResults(response));
}

export function createWebSearchTools(config: Config) {
  return [
    tool({
      name: "web_search",
      description:
        "Search the web using configured provider and return normalized results.",
      inputSchema: InputSchema,
      callback: async (input, context?: ToolContext) => {
        const searchTimeoutMs =
          config.search.provider === "firecrawl" ||
          config.search.provider === "litellm"
            ? FIRECRAWL_SEARCH_TIMEOUT_SECONDS * 1000
            : DEFAULT_TIMEOUT_SECONDS * 1000;
        const timeoutSignal = AbortSignal.timeout(searchTimeoutMs);
        const signal = context
          ? AbortSignal.any([timeoutSignal, context.agent.cancelSignal])
          : timeoutSignal;
        const provider = config.search.provider;
        if (provider === "duckduckgo") {
          return toJsonValue(await searchDuckDuckGo(input, signal));
        }
        if (provider === "brave") {
          const apiKey = config.search.brave.apiKey;
          if (!apiKey) {
            throw new Error(
              "Search provider is brave but search.brave.apiKey is missing.",
            );
          }
          return toJsonValue(await searchBrave(input, apiKey, signal));
        }
        if (provider === "exa") {
          const apiKey = config.search.exa.apiKey;
          if (!apiKey) {
            throw new Error(
              "Search provider is exa but search.exa.apiKey is missing.",
            );
          }
          return toJsonValue(await searchExa(input, apiKey, signal));
        }
        if (provider === "firecrawl") {
          const apiKey = config.search.firecrawl.apiKey;
          if (!apiKey) {
            throw new Error(
              "Search provider is firecrawl but search.firecrawl.apiKey is missing.",
            );
          }
          return toJsonValue(await searchFirecrawl(input, apiKey, signal));
        }
        if (provider === "litellm") {
          const { baseURL, apiKey, tool: searchTool } = config.search.litellm;
          if (!baseURL) {
            throw new Error(
              "Search provider is litellm but search.litellm.baseURL is missing.",
            );
          }
          if (!searchTool) {
            throw new Error(
              "Search provider is litellm but search.litellm.tool is missing.",
            );
          }
          if (!apiKey) {
            throw new Error(
              "Search provider is litellm but search.litellm.apiKey is missing.",
            );
          }
          return toJsonValue(
            await searchLiteLLM(input, { baseURL, apiKey, searchTool }, signal),
          );
        }
        if (provider === "serper") {
          const apiKey = config.search.serper.apiKey;
          if (!apiKey) {
            throw new Error(
              "Search provider is serper but search.serper.apiKey is missing.",
            );
          }
          return toJsonValue(await searchSerper(input, apiKey, signal));
        }
        const apiKey = config.search.tavily.apiKey;
        if (!apiKey) {
          throw new Error(
            "Search provider is tavily but search.tavily.apiKey is missing.",
          );
        }
        return toJsonValue(await searchTavily(input, apiKey));
      },
    }),
  ];
}
