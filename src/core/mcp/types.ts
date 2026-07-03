import { z } from "zod";
import { McpOAuthConfigSchema } from "./oauth/types.js";

const headersOrEnvVarsSchema = z.record(z.string(), z.string()).optional();

/** MCP stdio server: subprocess with JSON-RPC over stdin/stdout. */
export const StdioSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: headersOrEnvVarsSchema,
  cwd: z.string().optional(),
});

/** MCP remote server over streamable HTTP (preferred over legacy SSE). */
export const StreamableHttpSchema = z.object({
  type: z.literal("streamable-http"),
  url: z.url(),
  headers: headersOrEnvVarsSchema,
  oauth: McpOAuthConfigSchema.optional(),
});

/** MCP remote server over SSE + POST messages (legacy transport). */
export const SseSchema = z.object({
  type: z.literal("sse"),
  url: z.url(),
  headers: headersOrEnvVarsSchema,
  oauth: McpOAuthConfigSchema.optional(),
});

/**
 * Infer the transport `type` when omitted so shorthand entries work:
 * a `command` implies `stdio`, a `url` implies `streamable-http`. Entries that
 * already declare `type` are left untouched.
 */
function inferTransportType(value: unknown): unknown {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    "type" in value
  ) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.command === "string") {
    return { ...record, type: "stdio" };
  }
  if (typeof record.url === "string") {
    return { ...record, type: "streamable-http" };
  }
  return value;
}

export const McpTransportSchema = z.preprocess(
  inferTransportType,
  z.discriminatedUnion("type", [StdioSchema, StreamableHttpSchema, SseSchema]),
);

export type Stdio = z.infer<typeof StdioSchema>;
export type StreamableHttp = z.infer<typeof StreamableHttpSchema>;
export type Sse = z.infer<typeof SseSchema>;
export type McpTransport = z.infer<typeof McpTransportSchema>;
