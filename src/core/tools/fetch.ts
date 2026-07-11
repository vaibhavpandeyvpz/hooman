import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import TurndownService from "turndown";
import { z } from "zod";
import { normalizeUserPath } from "../utils/normalize-user-path.js";
import { assertRemoteUrl, isHttpUrl } from "../utils/url-safety.js";

async function createUserAgent(): Promise<string> {
  const packageUrl = new URL("../../../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(packageUrl, "utf8")) as {
    name?: string;
    version?: string;
  };
  return `${pkg.name ?? "hoomanjs"}/${pkg.version ?? "0.0.0"}`;
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_DOWNLOAD_TIMEOUT_SECONDS = 60;
const DEFAULT_MAX_LENGTH = 5000;
const MAX_FETCH_LENGTH = 1_000_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
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
    save_as: z
      .string()
      .min(1)
      .optional()
      .describe(
        "When set, stream the response body to this local filesystem path instead of returning content text.",
      ),
    max_length: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_FETCH_LENGTH)
      .optional()
      .describe(
        "Maximum number of characters to return (ignored when save_as is set).",
      ),
    start_index: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Start returning content from this character index (ignored when save_as is set).",
      ),
    raw: z
      .boolean()
      .optional()
      .describe(
        "Return raw response text instead of simplifying HTML to markdown (ignored when save_as is set).",
      ),
    timeout: z.coerce
      .number()
      .positive()
      .optional()
      .describe("Request timeout in seconds."),
    max_bytes: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_DOWNLOAD_BYTES)
      .optional()
      .describe(
        "Maximum number of bytes to write when save_as is set (default 100 MiB).",
      ),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe("Optional extra HTTP headers."),
  });
}

async function saveResponseToPath(options: {
  url: URL;
  response: Response;
  filePath: string;
  maxBytes: number;
}): Promise<{ bytesWritten: number; contentType: string }> {
  const { url, response, filePath, maxBytes } = options;

  if (!response.body) {
    throw new Error(`Empty response body: GET ${url.toString()}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `Remote content-length (${declared} bytes) exceeds max_bytes (${maxBytes}).`,
      );
    }
  }

  await mkdir(path.dirname(filePath), { recursive: true });

  let bytesWritten = 0;
  let wroteFile = false;

  try {
    const nodeStream = Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream,
    );
    nodeStream.on("data", (chunk: Buffer | string) => {
      bytesWritten +=
        typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (bytesWritten > maxBytes) {
        nodeStream.destroy(
          new Error(
            `Download exceeded max_bytes (${maxBytes}) after ${bytesWritten} bytes.`,
          ),
        );
      }
    });

    await pipeline(nodeStream, createWriteStream(filePath));
    wroteFile = true;

    return {
      bytesWritten,
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    if (wroteFile || bytesWritten > 0) {
      await unlink(filePath).catch(() => undefined);
    }
    throw error;
  }
}

export function createFetchTools() {
  const inputSchema = createFetchInputSchema();

  return [
    tool({
      name: "fetch",
      description:
        "Fetch a remote URL and return response content, or save the response body to a local path with save_as. HTML pages are simplified to markdown by default to save context window and tokens.",
      inputSchema,
      callback: async (input, context?: ToolContext) => {
        const saveAs = input.save_as?.trim();
        const timeoutSeconds =
          input.timeout ??
          (saveAs ? DEFAULT_DOWNLOAD_TIMEOUT_SECONDS : DEFAULT_TIMEOUT_SECONDS);
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
            saveAs
              ? "*/*"
              : "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
          );
        }

        try {
          const response = await fetch(url, {
            method: "GET",
            headers,
            redirect: "follow",
            signal,
          });

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status} ${response.statusText}: GET ${url.toString()}`,
            );
          }

          if (saveAs) {
            const filePath = normalizeUserPath(saveAs);
            const maxBytes = input.max_bytes ?? DEFAULT_MAX_BYTES;
            const saved = await saveResponseToPath({
              url,
              response,
              filePath,
              maxBytes,
            });

            return toJsonValue({
              url: url.toString(),
              saved_as: filePath,
              status: response.status,
              statusText: response.statusText,
              headers: responseHeaders(response.headers),
              content_type: saved.contentType || null,
              bytes_written: saved.bytesWritten,
              max_bytes: maxBytes,
            });
          }

          const text = await response.text();
          const contentType = response.headers.get("content-type") ?? "";

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
