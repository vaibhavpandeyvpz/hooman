import { z } from "zod";

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
});

/** MCP remote server over SSE + POST messages (legacy transport). */
export const SseSchema = z.object({
  type: z.literal("sse"),
  url: z.url(),
  headers: headersOrEnvVarsSchema,
});

export const McpTransportSchema = z.discriminatedUnion("type", [
  StdioSchema,
  StreamableHttpSchema,
  SseSchema,
]);

export type Stdio = z.infer<typeof StdioSchema>;
export type StreamableHttp = z.infer<typeof StreamableHttpSchema>;
export type Sse = z.infer<typeof SseSchema>;
export type McpTransport = z.infer<typeof McpTransportSchema>;
