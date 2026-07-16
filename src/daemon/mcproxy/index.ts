import type { Manager as McpManager } from "../../core/mcp/index.js";
import { DaemonToolCatalog } from "./catalog.js";
import { startDaemonMcpHttpServer } from "./http-server.js";
import { createDaemonProxyServer } from "./session.js";

/** ACP protocol `McpServerHttp` shape for the daemon's aggregate proxy (no auth/headers). */
export type DaemonMcpProxyServer = {
  name: "daemon";
  type: "http";
  url: string;
  headers: [];
};

export type DaemonMcpProxy = {
  /** Session-scoped `mcpServers` entry to pass on every `session/new` / `session/resume` for daemon-hosted ACP sessions. */
  mcpServer: DaemonMcpProxyServer;
  close(): Promise<void>;
};

/**
 * Starts the daemon's local, loopback-only aggregate MCP tool proxy in front
 * of the parent `Manager`'s already-connected upstream servers. Call once,
 * after the parent has connected/subscribed to channels and before creating
 * any ACP session; every daemon-hosted ACP session gets the one returned
 * `mcpServer` entry instead of loading local `mcp.json`.
 */
export async function startDaemonMcpProxy(
  manager: McpManager,
  options: { port?: number } = {},
): Promise<DaemonMcpProxy> {
  const catalog = new DaemonToolCatalog(manager);
  const instructions = (await manager.listServerInstructions()).join("\n\n");
  const handle = await startDaemonMcpHttpServer({
    port: options.port ?? 0,
    createSession: () => createDaemonProxyServer(catalog, instructions),
  });
  return {
    mcpServer: { name: "daemon", type: "http", url: handle.url, headers: [] },
    close: handle.close,
  };
}
