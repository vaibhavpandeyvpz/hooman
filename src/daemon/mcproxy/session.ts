import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { DaemonToolCatalog } from "./catalog.js";

const packageUrl = new URL("../../../package.json", import.meta.url);
const packageVersion =
  (JSON.parse(readFileSync(packageUrl, "utf8")) as { version?: string })
    .version ?? "0.0.0";

/**
 * One frontend MCP session for a daemon-hosted ACP child: a fresh low-level
 * `Server` per HTTP initialize handshake, exposing only the aggregate tool
 * catalog (no experimental channel capabilities — those stay on the parent's
 * singleton upstream connections).
 */
export function createDaemonProxyServer(
  catalog: DaemonToolCatalog,
  instructions: string,
): Server {
  const server = new Server(
    { name: "hooman-daemon-mcproxy", version: packageVersion },
    {
      capabilities: { tools: {} },
      instructions: instructions.length > 0 ? instructions : undefined,
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await catalog.listTools(),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    catalog.callTool(
      request.params.name,
      request.params.arguments,
      extra.signal,
    ),
  );
  return server;
}
