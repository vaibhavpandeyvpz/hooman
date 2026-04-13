import dns from "node:dns/promises";
import net from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import TurndownService from "turndown";
import { z } from "zod";

async function createUserAgent(): Promise<string> {
  const path = new URL("../../../package.json", import.meta.url);
  const pkg = (await Bun.file(path).json()) as {
    name?: string;
    version?: string;
  };
  return `${pkg.name ?? "hoomanity"}/${pkg.version ?? "0.0.0"}`;
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_LENGTH = 5000;
const MAX_FETCH_LENGTH = 1_000_000;

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function isHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  return url;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

function isPrivateIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;

    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

async function assertRemoteUrl(url: URL): Promise<void> {
  if (isPrivateHostname(url.hostname)) {
    throw new Error("Fetching localhost or loopback URLs is not allowed.");
  }

  const resolved = await dns.lookup(url.hostname, { all: true });
  if (resolved.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Fetching private-network URLs is not allowed.");
  }
}

function responseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function isHtml(contentType: string, body: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("text/html") ||
    normalized.includes("application/xhtml+xml") ||
    /^\s*<!doctype html/i.test(body) ||
    /^\s*<html[\s>]/i.test(body)
  );
}

function tryFormatJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function htmlToMarkdown(
  html: string,
  baseUrl: string,
): { markdown: string; title?: string | null } {
  const dom = new JSDOM(html, { url: baseUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const source = article?.content ?? dom.window.document.body?.innerHTML ?? "";
  const markdown = turndown.turndown(source).trim();

  return {
    markdown: markdown || "Page could not be simplified to markdown.",
    title: article?.title ?? dom.window.document.title ?? null,
  };
}

function sliceContent(
  content: string,
  startIndex: number,
  maxLength: number,
): { content: string; truncated: boolean; nextStartIndex: number | null } {
  if (startIndex >= content.length) {
    return {
      content: "No more content available.",
      truncated: false,
      nextStartIndex: null,
    };
  }

  const slice = content.slice(startIndex, startIndex + maxLength);
  const nextStartIndex =
    startIndex + slice.length < content.length
      ? startIndex + slice.length
      : null;

  return {
    content: slice,
    truncated: nextStartIndex !== null,
    nextStartIndex,
  };
}

function createFetchInputSchema() {
  return z.object({
    url: z.string().url().describe("Remote HTTP(S) URL to fetch."),
    max_length: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_FETCH_LENGTH)
      .optional()
      .describe("Maximum number of characters to return."),
    start_index: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Start returning content from this character index."),
    raw: z
      .boolean()
      .optional()
      .describe(
        "Return raw response text instead of simplifying HTML to markdown.",
      ),
    timeout: z.coerce
      .number()
      .positive()
      .optional()
      .describe("Request timeout in seconds."),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe("Optional extra HTTP headers."),
  });
}

export function createFetchTools() {
  const inputSchema = createFetchInputSchema();

  return [
    tool({
      name: "fetch",
      description:
        "Fetch a remote URL and return response content. HTML pages are simplified to markdown by default to save context window and tokens.",
      inputSchema,
      callback: async (input, context?: ToolContext) => {
        const timeoutSeconds = input.timeout ?? DEFAULT_TIMEOUT_SECONDS;
        const timeoutSignal = AbortSignal.timeout(timeoutSeconds * 1000);
        const signal = context
          ? AbortSignal.any([timeoutSignal, context.agent.cancelSignal])
          : timeoutSignal;

        const url = isHttpUrl(input.url);
        await assertRemoteUrl(url);

        const headers = new Headers(input.headers);
        if (!headers.has("user-agent")) {
          headers.set("user-agent", await createUserAgent());
        }
        if (!headers.has("accept")) {
          headers.set(
            "accept",
            "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
          );
        }

        try {
          const response = await fetch(url, {
            method: "GET",
            headers,
            redirect: "follow",
            signal,
          });

          const text = await response.text();
          const contentType = response.headers.get("content-type") ?? "";

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status} ${response.statusText}: GET ${url.toString()}`,
            );
          }

          let transformed = text;
          let transformedFormat: "raw" | "markdown" | "json-pretty" = "raw";
          let title: string | null | undefined;

          if (!input.raw && isHtml(contentType, text)) {
            const result = htmlToMarkdown(text, url.toString());
            transformed = result.markdown;
            transformedFormat = "markdown";
            title = result.title;
          } else if (contentType.toLowerCase().includes("json")) {
            transformed = tryFormatJson(text);
            transformedFormat = "json-pretty";
          }

          const paged = sliceContent(
            transformed,
            input.start_index ?? 0,
            input.max_length ?? DEFAULT_MAX_LENGTH,
          );

          return toJsonValue({
            url: url.toString(),
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders(response.headers),
            content_type: contentType || null,
            format: transformedFormat,
            title: title ?? null,
            start_index: input.start_index ?? 0,
            max_length: input.max_length ?? DEFAULT_MAX_LENGTH,
            total_length: transformed.length,
            truncated: paged.truncated,
            next_start_index: paged.nextStartIndex,
            content: paged.content,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            const reason = timeoutSignal.aborted
              ? `Request timed out after ${timeoutSeconds} seconds`
              : "Request was cancelled";
            throw new Error(`${reason}: ${url.toString()}`);
          }
          throw error;
        }
      },
    }),
  ];
}
