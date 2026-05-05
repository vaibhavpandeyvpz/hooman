import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { tavily } from "@tavily/core";
import { z } from "zod";
import type { Config } from "../config.js";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const EXA_ENDPOINT = "https://api.exa.ai/search";
const SERPER_ENDPOINT = "https://google.serper.dev/search";
const DEFAULT_TIMEOUT_SECONDS = 20;
const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 20;

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
  provider: "brave" | "exa" | "serper" | "tavily";
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

function normalizedOutput(
  provider: "brave" | "exa" | "serper" | "tavily",
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
  const body: Record<string, unknown> = {
    query: input.query,
    numResults: input.count,
    type: "auto",
    contents: { highlights: true },
  };
  if (input.country) {
    body.userLocation = input.country.toUpperCase();
  }
  const published = exaPublishedRange(input);
  if (published.startPublishedDate) {
    body.startPublishedDate = published.startPublishedDate;
  }
  if (published.endPublishedDate) {
    body.endPublishedDate = published.endPublishedDate;
  }
  if (input.safe_search === true) {
    body.moderation = true;
  }

  const response = await fetch(EXA_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    let detail = responseText;
    try {
      const errJson = JSON.parse(responseText) as { error?: string };
      if (typeof errJson.error === "string" && errJson.error.length > 0) {
        detail = errJson.error;
      }
    } catch {
      /* keep raw body */
    }
    throw new Error(
      `Exa search failed (${response.status} ${response.statusText}): ${detail}`,
    );
  }
  const parsed = JSON.parse(responseText) as unknown;
  return normalizedOutput("exa", input, normalizeExaResults(parsed));
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
        const timeoutSignal = AbortSignal.timeout(
          DEFAULT_TIMEOUT_SECONDS * 1000,
        );
        const signal = context
          ? AbortSignal.any([timeoutSignal, context.agent.cancelSignal])
          : timeoutSignal;
        const provider = config.search.provider;
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
