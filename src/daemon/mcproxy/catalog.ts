import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Manager as McpManager } from "../../core/mcp/index.js";
import { mcpServerPrefix } from "../../core/mcp/prefixed-mcp-tool.js";

type CatalogRoute = { server: string; wireName: string };

/**
 * Aggregates tools from every configured MCP server the daemon's `Manager`
 * already has connected, exposing them under collision-safe proxied names
 * (`${slugifiedServer}__${wireName}`, deterministically suffixed on slug
 * collisions) and demultiplexing `tools/call` back to the exact upstream
 * server + original wire tool name via an explicit route map — never by
 * parsing caller-controlled names.
 */
export class DaemonToolCatalog {
  #routes = new Map<string, CatalogRoute>();

  public constructor(private readonly manager: McpManager) {}

  /** Deterministic proxied-name prefix per server, suffixing slug collisions by sorted server name order. */
  #resolvePrefixes(serverNames: readonly string[]): Map<string, string> {
    const sorted = [...serverNames].sort((a, b) => a.localeCompare(b));
    const counts = new Map<string, number>();
    const prefixes = new Map<string, string>();
    for (const server of sorted) {
      const base = mcpServerPrefix(server);
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      prefixes.set(server, count === 1 ? base : `${base}_${count}`);
    }
    return prefixes;
  }

  public async listTools(): Promise<Tool[]> {
    const servers = this.manager.listServers().map((entry) => entry.name);
    const prefixes = this.#resolvePrefixes(servers);
    const perServer = await Promise.all(
      servers.map(async (server) => {
        try {
          return { server, tools: await this.manager.listServerTools(server) };
        } catch {
          return { server, tools: [] as Tool[] };
        }
      }),
    );

    const routes = new Map<string, CatalogRoute>();
    const tools: Tool[] = [];
    for (const { server, tools: serverTools } of perServer) {
      const prefix = prefixes.get(server) ?? mcpServerPrefix(server);
      for (const tool of serverTools) {
        const name = `${prefix}__${tool.name}`;
        routes.set(name, { server, wireName: tool.name });
        tools.push({
          ...tool,
          name,
          description: tool.description
            ? `${tool.description} (MCP server: ${server})`
            : `MCP server: ${server}`,
        });
      }
    }
    this.#routes = routes;
    return tools;
  }

  public async callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    let route = this.#routes.get(name);
    if (!route) {
      await this.listTools();
      route = this.#routes.get(name);
    }
    if (!route) {
      throw new Error(`Unknown tool "${name}".`);
    }
    return this.manager.callServerTool(
      route.server,
      { name: route.wireName, arguments: args },
      signal,
    );
  }
}
