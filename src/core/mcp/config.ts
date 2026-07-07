import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { McpTransportSchema, type McpTransport } from "./types.js";

const McpServersFileSchema = z.object({
  mcpServers: z.record(z.string().min(1), McpTransportSchema).default({}),
});

export type McpServersFile = z.infer<typeof McpServersFileSchema>;
export type ConfigOptions = {
  overlayPaths?: readonly string[];
  projectPath?: string;
};

/** One named MCP transport from the config file. */
export type NamedMcpTransport = { name: string; transport: McpTransport };

export type McpConfigScope = "global" | "project";

export type NamedMcpTransportWithSource = NamedMcpTransport & {
  sourcePath: string;
  scope: McpConfigScope;
};

export type McpWriteTarget = {
  path: string;
  scope: McpConfigScope;
};

/**
 * Read/write `{"mcpServers": { "<name>": <transport> }}` on disk.
 */
export class Config {
  private readonly path: string;
  private readonly overlayPaths: string[];
  private readonly projectPath?: string;
  private entries: Record<string, NamedMcpTransportWithSource>;

  public constructor(path: string, options?: ConfigOptions) {
    this.path = resolve(path);
    this.overlayPaths = [...(options?.overlayPaths ?? [])].map((overlayPath) =>
      resolve(overlayPath),
    );
    this.projectPath = options?.projectPath
      ? resolve(options.projectPath)
      : undefined;
    this.entries = {};
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

  private sourcePaths(): string[] {
    return [this.path, ...this.overlayPaths];
  }

  private scopeForPath(path: string): McpConfigScope {
    return resolve(path) === this.path ? "global" : "project";
  }

  private mergedEntries(): Record<string, NamedMcpTransportWithSource> {
    const entries: Record<string, NamedMcpTransportWithSource> = {};
    for (const path of this.sourcePaths()) {
      const file = this.parse(path, { mcpServers: {} });
      for (const [name, transport] of Object.entries(file.mcpServers)) {
        entries[name] = {
          name,
          transport,
          sourcePath: path,
          scope: this.scopeForPath(path),
        };
      }
    }
    return entries;
  }

  /** Reload servers from disk (overwrites unsaved in-memory changes). */
  public reload(): void {
    const wasMissing = !existsSync(this.path);
    this.entries = this.mergedEntries();
    if (wasMissing) {
      this.persistFile(this.path, { mcpServers: {} });
    }
  }

  /** All configured servers, stable sort by name. */
  public list(): NamedMcpTransport[] {
    return this.listWithSources().map(({ name, transport }) => ({
      name,
      transport,
    }));
  }

  /** All configured servers, stable sort by name, including source metadata. */
  public listWithSources(): NamedMcpTransportWithSource[] {
    return Object.values(this.entries).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  public get(name: string): McpTransport | undefined {
    return this.entries[name]?.transport;
  }

  public getEntry(name: string): NamedMcpTransportWithSource | undefined {
    return this.entries[name];
  }

  public primaryPath(): string {
    return this.path;
  }

  public writableTargets(): McpWriteTarget[] {
    const targets: McpWriteTarget[] = [{ path: this.path, scope: "global" }];
    if (this.projectPath && this.projectPath !== this.path) {
      targets.push({ path: this.projectPath, scope: "project" });
    }
    return targets;
  }

  private persistFile(path: string, data: McpServersFile): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  }

  private requireVisibleEntry(name: string): NamedMcpTransportWithSource {
    const entry = this.getEntry(name);
    if (!entry) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    return entry;
  }

  public add(name: string, transport: McpTransport): void {
    this.addToPath(this.path, name, transport);
  }

  public update(name: string, transport: McpTransport): void {
    this.updateInPath(this.path, name, transport);
  }

  public remove(name: string): void {
    this.removeFromPath(this.path, name);
  }

  public addToPath(
    targetPath: string,
    name: string,
    transport: McpTransport,
  ): void {
    if (this.get(name)) {
      throw new Error(`MCP server "${name}" already exists.`);
    }
    const resolvedTargetPath = resolve(targetPath);
    const file = this.parse(resolvedTargetPath, { mcpServers: {} });
    if (file.mcpServers[name]) {
      throw new Error(`MCP server "${name}" already exists.`);
    }
    file.mcpServers[name] = transport;
    this.persistFile(resolvedTargetPath, file);
    this.reload();
  }

  public updateInPath(
    targetPath: string,
    name: string,
    transport: McpTransport,
  ): void {
    const resolvedTargetPath = resolve(targetPath);
    const entry = this.requireVisibleEntry(name);
    if (entry.sourcePath !== resolvedTargetPath) {
      throw new Error(
        `MCP server "${name}" is defined in "${entry.sourcePath}", not "${resolvedTargetPath}".`,
      );
    }
    const file = this.parse(resolvedTargetPath, { mcpServers: {} });
    if (!file.mcpServers[name]) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    file.mcpServers[name] = transport;
    this.persistFile(resolvedTargetPath, file);
    this.reload();
  }

  public renameInPath(
    targetPath: string,
    currentName: string,
    nextName: string,
    transport: McpTransport,
  ): void {
    const resolvedTargetPath = resolve(targetPath);
    const entry = this.requireVisibleEntry(currentName);
    if (entry.sourcePath !== resolvedTargetPath) {
      throw new Error(
        `MCP server "${currentName}" is defined in "${entry.sourcePath}", not "${resolvedTargetPath}".`,
      );
    }
    if (currentName === nextName) {
      this.updateInPath(resolvedTargetPath, currentName, transport);
      return;
    }
    const existing = this.getEntry(nextName);
    if (existing) {
      throw new Error(`MCP server "${nextName}" already exists.`);
    }
    const file = this.parse(resolvedTargetPath, { mcpServers: {} });
    if (!file.mcpServers[currentName]) {
      throw new Error(`MCP server "${currentName}" does not exist.`);
    }
    const { [currentName]: _removed, ...remaining } = file.mcpServers;
    file.mcpServers = { ...remaining, [nextName]: transport };
    this.persistFile(resolvedTargetPath, file);
    this.reload();
  }

  public removeFromPath(targetPath: string, name: string): void {
    const resolvedTargetPath = resolve(targetPath);
    const entry = this.requireVisibleEntry(name);
    if (entry.sourcePath !== resolvedTargetPath) {
      throw new Error(
        `MCP server "${name}" is defined in "${entry.sourcePath}", not "${resolvedTargetPath}".`,
      );
    }
    const file = this.parse(resolvedTargetPath, { mcpServers: {} });
    if (!file.mcpServers[name]) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    const { [name]: _removed, ...remaining } = file.mcpServers;
    file.mcpServers = remaining;
    this.persistFile(resolvedTargetPath, file);
    this.reload();
  }
}
