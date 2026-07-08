import { ToolValidationError } from "@strands-agents/sdk";
import type { Tool } from "@strands-agents/sdk";
import { MODE_IDS, type KnownSessionMode } from "../modes/schema.js";
import {
  getActiveMcpToolNames,
  type AgentLike as ActiveMcpAgentLike,
} from "../state/active-mcp-tools.js";
import { getModeState } from "../state/session-mode.js";
import { isToolVisible } from "../state/tool-approvals.js";

export type ToolCatalogEntry = {
  name: string;
  description: string;
  server: string;
  readOnly: boolean;
  args: string[];
  modes: KnownSessionMode[];
  tool: Tool;
};

type AgentLike = ActiveMcpAgentLike;

function toolVisibilityOptions(
  tool: Tool,
): { mcpReadOnlyHint?: boolean } | undefined {
  if (
    "mcpReadOnlyHint" in tool &&
    (tool as { mcpReadOnlyHint?: boolean }).mcpReadOnlyHint === true
  ) {
    return { mcpReadOnlyHint: true };
  }
  return undefined;
}

function buildToolModes(name: string, readOnly: boolean): KnownSessionMode[] {
  return MODE_IDS.filter((mode) =>
    isToolVisible(mode, name, readOnly ? { mcpReadOnlyHint: true } : undefined),
  );
}

/**
 * Tool registry that mirrors Strands SDK registry semantics and lazily exposes
 * MCP tools based on session mode plus the current session's activated MCP set.
 */
export class LazyToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly catalog = new Map<string, ToolCatalogEntry>();
  private agent: AgentLike | null = null;

  constructor(tools?: Tool[]) {
    if (tools) {
      this.add(tools);
    }
  }

  attachAgent(agent: AgentLike): void {
    this.agent = agent;
  }

  add(tool: Tool | Tool[]): void {
    const tools = Array.isArray(tool) ? tool : [tool];
    for (const t of tools) {
      this.#validate(t, this.tools);
      this.tools.set(t.name, t);
      this.catalog.delete(t.name);
    }
  }

  hide(tool: Tool, entry: Omit<ToolCatalogEntry, "tool">): void {
    this.#validate(tool, this.#catalogAsTools(), this.tools);
    this.catalog.set(tool.name, { ...entry, tool });
  }

  hidden(): ToolCatalogEntry[] {
    return [...this.catalog.values()].filter((entry) =>
      this.isToolActivatable(entry),
    );
  }

  hiddenEntry(name: string): ToolCatalogEntry | undefined {
    const entry = this.catalog.get(name);
    if (!entry || !this.isToolActivatable(entry)) {
      return undefined;
    }
    return entry;
  }

  isToolRegistered(name: string): boolean {
    return this.tools.has(name);
  }

  isToolActivatable(entry: ToolCatalogEntry): boolean {
    return entry.modes.includes(this.#mode() as KnownSessionMode);
  }

  get(name: string): Tool | undefined {
    const tool = this.tools.get(name) ?? this.#activatedTool(name);
    if (!tool) {
      return undefined;
    }
    if (!isToolVisible(this.#mode(), name, toolVisibilityOptions(tool))) {
      return undefined;
    }
    return tool;
  }

  remove(name: string): void {
    this.tools.delete(name);
    this.catalog.delete(name);
  }

  list(): Tool[] {
    const visible = new Map(this.tools);
    for (const name of this.#activeMcpNames()) {
      const entry = this.catalog.get(name);
      if (entry && this.isToolActivatable(entry)) {
        visible.set(name, entry.tool);
      }
    }
    return [...visible.values()].filter((tool) =>
      isToolVisible(this.#mode(), tool.name, toolVisibilityOptions(tool)),
    );
  }

  static buildMcpCatalogEntry(
    tool: Tool & {
      name: string;
      description: string;
      toolSpec: { inputSchema?: unknown };
    },
    server: string,
    readOnly: boolean,
  ): ToolCatalogEntry {
    const args = Object.keys(
      (
        tool.toolSpec.inputSchema as
          { properties?: Record<string, unknown> } | undefined
      )?.properties ?? {},
    );
    return {
      name: tool.name,
      description: tool.description,
      server,
      readOnly,
      args,
      modes: buildToolModes(tool.name, readOnly),
      tool,
    };
  }

  #mode(): string {
    return this.agent ? getModeState(this.agent).mode : "agent";
  }

  #activeMcpNames(): string[] {
    return this.agent ? getActiveMcpToolNames(this.agent) : [];
  }

  #activatedTool(name: string): Tool | undefined {
    if (!this.#activeMcpNames().includes(name)) {
      return undefined;
    }
    const entry = this.catalog.get(name);
    if (!entry || !this.isToolActivatable(entry)) {
      return undefined;
    }
    return entry.tool;
  }

  #catalogAsTools(): Map<string, Tool> {
    return new Map(
      [...this.catalog.entries()].map(([name, entry]) => [name, entry.tool]),
    );
  }

  #validate(
    tool: Tool,
    primary: Map<string, Tool>,
    secondary?: Map<string, Tool>,
  ): void {
    if (typeof tool.name !== "string") {
      throw new ToolValidationError("Tool name must be a string");
    }
    if (tool.name.length < 1 || tool.name.length > 64) {
      throw new ToolValidationError(
        "Tool name must be between 1 and 64 characters",
      );
    }
    const validNamePattern = /^[a-zA-Z0-9_-]+$/;
    if (!validNamePattern.test(tool.name)) {
      throw new ToolValidationError(
        "Tool name must contain only alphanumeric characters, hyphens, and underscores",
      );
    }
    if (tool.description !== undefined && tool.description !== null) {
      if (typeof tool.description !== "string" || tool.description.length < 1) {
        throw new ToolValidationError(
          "Tool description must be a non-empty string",
        );
      }
    }
    if (primary.has(tool.name) || secondary?.has(tool.name)) {
      throw new ToolValidationError(
        `Tool with name '${tool.name}' already registered`,
      );
    }
  }
}
