import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { McpTransportSchema, type McpTransport } from "./types.ts";

const McpServersFileSchema = z.object({
  mcpServers: z.record(z.string().min(1), McpTransportSchema).default({}),
});

export type McpServersFile = z.infer<typeof McpServersFileSchema>;

/** One named MCP transport from the config file. */
export type NamedMcpTransport = { name: string; transport: McpTransport };

/**
 * Read/write `{"mcpServers": { "<name>": <transport> }}` on disk.
 */
export class Config {
  private readonly path: string;
  private servers: Record<string, McpTransport>;

  public constructor(path: string) {
    this.path = path;
    this.servers = {};
    this.reload();
  }

  private readJson(): McpServersFile {
    if (!existsSync(this.path)) {
      return { mcpServers: {} };
    }
    const raw = readFileSync(this.path, "utf8");
    return JSON.parse(raw) as McpServersFile;
  }

  /** Reload servers from disk (overwrites unsaved in-memory changes). */
  public reload(): void {
    const parsed = McpServersFileSchema.parse(this.readJson());
    this.servers = { ...parsed.mcpServers };
  }

  private persist(): void {
    const payload: McpServersFile = { mcpServers: { ...this.servers } };
    writeFileSync(this.path, JSON.stringify(payload, null, 2), "utf8");
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

  public add(name: string, transport: McpTransport): void {
    if (Object.hasOwn(this.servers, name)) {
      throw new Error(`MCP server "${name}" already exists`);
    }
    this.servers[name] = transport;
    this.persist();
  }

  public update(name: string, transport: McpTransport): void {
    if (!Object.hasOwn(this.servers, name)) {
      throw new Error(`MCP server "${name}" not found`);
    }
    this.servers[name] = transport;
    this.persist();
  }

  public remove(name: string): void {
    if (!Object.hasOwn(this.servers, name)) {
      throw new Error(`MCP server "${name}" not found`);
    }
    delete this.servers[name];
    this.persist();
  }
}
