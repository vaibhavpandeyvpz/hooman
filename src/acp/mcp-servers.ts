import { RequestError, type McpServer } from "@agentclientprotocol/sdk";
import type { NamedMcpTransport } from "../core/mcp/index.ts";

function pairsToRecord(
  pairs: ReadonlyArray<{ name: string; value: string }>,
): Record<string, string> | undefined {
  if (pairs.length === 0) {
    return undefined;
  }
  return Object.fromEntries(pairs.map((pair) => [pair.name, pair.value]));
}

function toNamedTransport(server: McpServer): NamedMcpTransport {
  if ("command" in server) {
    return {
      name: server.name,
      transport: {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: pairsToRecord(server.env),
      },
    };
  }
  if (server.type === "http") {
    return {
      name: server.name,
      transport: {
        type: "streamable-http",
        url: server.url,
        headers: pairsToRecord(server.headers),
      },
    };
  }
  return {
    name: server.name,
    transport: {
      type: "sse",
      url: server.url,
      headers: pairsToRecord(server.headers),
    },
  };
}

/**
 * Convert ACP session MCP server definitions into the transport shape used by
 * Hooman's MCP manager.
 */
export function normalizeAcpSessionMcpServers(
  servers: readonly McpServer[] | null | undefined,
): NamedMcpTransport[] {
  const normalized = (servers ?? []).map(toNamedTransport);
  const seen = new Set<string>();
  for (const { name } of normalized) {
    if (seen.has(name)) {
      throw RequestError.invalidParams({
        mcpServers: servers,
        message: `Duplicate ACP MCP server name "${name}" in session request`,
      });
    }
    seen.add(name);
  }
  return normalized;
}
