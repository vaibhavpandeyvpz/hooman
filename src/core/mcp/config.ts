import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { McpTransportSchema, type McpTransport } from "./types.js";

const McpServersFileSchema = z.object({
  mcpServers: z.record(z.string().min(1), McpTransportSchema).default({}),
});

export type McpServersFile = z.infer<typeof McpServersFileSchema>;
export type ConfigOptions = {
  overlayPaths?: readonly string[];
};

/** One named MCP transport from the config file. */
export type NamedMcpTransport = { name: string; transport: McpTransport };

/**
 * Read/write `{"mcpServers": { "<name>": <transport> }}` on disk.
 */
export class Config {
  private readonly path: string;
  private readonly overlayPaths: string[];
  private servers: Record<string, McpTransport>;

  public constructor(path: string, options?: ConfigOptions) {
    this.path = path;
    this.overlayPaths = [...(options?.overlayPaths ?? [])];
    this.servers = {};
    this.reload();
  }

  private readJson(path: string, fallback: McpServersFile): McpServersFile {
    if (!existsSync(path)) {
      return fallback;
    }
    try {
      const raw = readFileSync(path, "utf8");
      return JSON.parse(raw) as McpServersFile;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown configuration error.";
      throw new Error(`Failed to load MCP config from "${path}": ${message}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  private parse(path: string, fallback: McpServersFile): McpServersFile {
    try {
      return McpServersFileSchema.parse(this.readJson(path, fallback));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown configuration error.";
      throw new Error(`Failed to parse MCP config from "${path}": ${message}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  private mergedServers(): Record<string, McpTransport> {
    const primary = this.parse(this.path, { mcpServers: {} });
    const merged = { ...primary.mcpServers };
    for (const overlayPath of this.overlayPaths) {
      const overlay = this.parse(overlayPath, { mcpServers: {} });
      Object.assign(merged, overlay.mcpServers);
    }
    return merged;
  }

  /** Reload servers from disk (overwrites unsaved in-memory changes). */
  public reload(): void {
    const wasMissing = !existsSync(this.path);
    this.servers = this.mergedServers();
    if (wasMissing) {
      this.persist();
    }
  }

  /** All configured servers, stable sort by name. */
  public list(): NamedMcpTransport[] {
    return Object.entries(this.servers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, transport]) => ({ name, transport }));
  }

  public get(name: string): McpTransport | undefined {
    return this.servers[name];
  }

  private persist(): void {
    const data: McpServersFile = { mcpServers: this.servers };
    writeFileSync(this.path, JSON.stringify(data, null, 2), "utf8");
  }

  public add(name: string, transport: McpTransport): void {
    if (this.servers[name]) {
      throw new Error(`MCP server "${name}" already exists.`);
    }
    this.servers = { ...this.servers, [name]: transport };
    this.persist();
  }

  public update(name: string, transport: McpTransport): void {
    if (!this.servers[name]) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    this.servers = { ...this.servers, [name]: transport };
    this.persist();
  }

  public remove(name: string): void {
    if (!this.servers[name]) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    const { [name]: _removed, ...remaining } = this.servers;
    this.servers = remaining;
    this.persist();
  }
}
