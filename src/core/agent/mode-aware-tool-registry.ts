import { ToolValidationError } from "@strands-agents/sdk";
import type { Tool } from "@strands-agents/sdk";
import { isToolVisible } from "../state/tool-approvals.js";
import type { SessionMode } from "../state/session-mode.js";

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

/**
 * Tool registry that mirrors Strands SDK registry semantics (name validation, map storage)
 * and filters tools by {@link SessionMode}. Avoids extending SDK-internal `ToolRegistry`, which
 * is not exported and breaks under hoisted `@strands-agents/sdk`.
 */
export class ModeAwareToolRegistry {
  private readonly _tools = new Map<string, Tool>();
  private mode: SessionMode = "default";

  constructor(tools?: Tool[]) {
    if (tools) {
      this.add(tools);
    }
  }

  setSessionMode(mode: SessionMode): void {
    this.mode = mode;
  }

  add(tool: Tool | Tool[]): void {
    const tools = Array.isArray(tool) ? tool : [tool];
    for (const t of tools) {
      this.#validate(t);
      this._tools.set(t.name, t);
    }
  }

  get(name: string): Tool | undefined {
    const t = this._tools.get(name);
    if (!t) {
      return undefined;
    }
    if (!isToolVisible(this.mode, name, toolVisibilityOptions(t))) {
      return undefined;
    }
    return t;
  }

  remove(name: string): void {
    this._tools.delete(name);
  }

  list(): Tool[] {
    return Array.from(this._tools.values()).filter((t) =>
      isToolVisible(this.mode, t.name, toolVisibilityOptions(t)),
    );
  }

  #validate(tool: Tool): void {
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
    if (this._tools.has(tool.name)) {
      throw new ToolValidationError(
        `Tool with name '${tool.name}' already registered`,
      );
    }
  }
}
