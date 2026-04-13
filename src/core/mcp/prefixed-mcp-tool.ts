import {
  Tool,
  type ToolContext,
  type ToolSpec,
  type ToolStreamGenerator,
} from "@strands-agents/sdk";
import slugify from "slugify";

function mcpServerPrefix(serverKey: string): string {
  const slug = slugify(serverKey, {
    replacement: "_",
    lower: true,
    strict: true,
  });
  return slug.length > 0 ? slug : "mcp";
}

/**
 * Exposes MCP server tools to the model as `slugifiedServerKey__originalName`
 * while delegating execution to the stock SDK tool (correct wire name).
 */
export class PrefixedMcpTool extends Tool {
  name: string;
  description: string;
  toolSpec: ToolSpec;

  public constructor(
    private readonly serverKey: string,
    private readonly inner: Tool,
  ) {
    super();
    const prefix = mcpServerPrefix(serverKey);
    this.name = `${prefix}__${inner.name}`;
    this.description = `${inner.description} (MCP server: ${serverKey})`;
    this.toolSpec = {
      ...inner.toolSpec,
      name: this.name,
      description: this.description,
    };
  }

  stream(toolContext: ToolContext): ToolStreamGenerator {
    return this.inner.stream(toolContext);
  }
}
