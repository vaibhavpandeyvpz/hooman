import { McpClient, type Tool } from "@strands-agents/sdk";
import { PrefixedMcpTool } from "./prefixed-mcp-tool.ts";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Config, type NamedMcpTransport } from "./config.ts";
import type { McpTransport } from "./types.ts";

function transportFor(spec: McpTransport): Transport {
  switch (spec.type) {
    case "stdio":
      return new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        env: spec.env,
        cwd: spec.cwd,
        stderr: "ignore",
      });
    case "streamable-http": {
      const headers = spec.headers;
      return new StreamableHTTPClientTransport(new URL(spec.url), {
        requestInit: headers ? { headers } : undefined,
      });
    }
    case "sse": {
      const headers = spec.headers;
      return new SSEClientTransport(new URL(spec.url), {
        requestInit: headers ? { headers } : undefined,
      });
    }
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

/**
 * Holds one {@link McpClient} per named entry in {@link Config}. Call {@link reload}
 * after changing the file on disk (or construct and then {@link reload} once).
 */
export class Manager {
  private instances: Map<string, McpClient> | null = null;

  public constructor(
    private readonly config: Config,
    private readonly mcpServers: readonly NamedMcpTransport[] = [],
  ) {}

  /** Lazily builds clients from the current in-memory config (reloads file first). */
  get clients(): ReadonlyMap<string, McpClient> {
    if (this.instances === null) {
      this.reload();
    }
    return this.instances!;
  }

  /**
   * Rereads the config file, replaces all clients, and best-effort disconnects
   * previous clients (stdio subprocesses, HTTP sessions).
   */
  public reload(): void {
    this.config.reload();
    const previous = this.instances;
    const next = new Map<string, McpClient>();
    const transports = [
      ...this.config.list(),
      // Session-scoped ACP servers intentionally override local config names.
      ...this.mcpServers,
    ];
    for (const { name, transport } of transports) {
      next.set(
        name,
        new McpClient({
          transport: transportFor(transport),
        }),
      );
    }
    this.instances = next;
    if (previous?.size) {
      for (const client of previous.values()) {
        void client.disconnect().catch(() => {});
      }
    }
  }

  public async disconnect(): Promise<void> {
    const toClose = this.instances;
    this.instances = null;
    if (!toClose?.size) {
      return;
    }
    await Promise.all(
      [...toClose.values()].map((c) => c.disconnect().catch(() => undefined)),
    );
  }

  /**
   * Lists tools from every configured MCP client with names prefixed by a
   * slugified server config key (see {@link PrefixedMcpTool}).
   */
  public async listPrefixedTools(): Promise<Tool[]> {
    if (this.instances === null) {
      this.reload();
    }
    const map = this.instances!;
    const batches = await Promise.all(
      [...map.entries()].map(async ([serverKey, client]) =>
        client
          .listTools()
          .then((tools) => tools.map((t) => new PrefixedMcpTool(serverKey, t))),
      ),
    );
    return batches.flat();
  }
}
