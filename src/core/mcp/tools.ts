import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";
import type { Config } from "./config.js";
import { McpTransportSchema } from "./types.js";

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

const NamedTransportSchema = z.object({
  name: z.string().min(1).describe("Unique MCP server name."),
  transport: McpTransportSchema.describe(
    "Transport configuration for the MCP server.",
  ),
});

export function createMcpTools(config: Config) {
  return [
    tool({
      name: "list_mcp_servers",
      description:
        "List configured MCP servers from the local MCP config file.",
      inputSchema: z.object({}),
      callback: async () => {
        const servers = config.list();
        return toJsonValue({
          count: servers.length,
          servers,
        });
      },
    }),
    tool({
      name: "get_mcp_server",
      description: "Get a configured MCP server by name.",
      inputSchema: z.object({
        name: z.string().min(1).describe("MCP server name."),
      }),
      callback: async (input) => {
        const transport = config.get(input.name);
        return toJsonValue({
          name: input.name,
          found: transport !== undefined,
          transport: transport ?? null,
        });
      },
    }),
    tool({
      name: "add_mcp_server",
      description:
        "Add a new MCP server configuration to the local MCP config file.",
      inputSchema: NamedTransportSchema,
      callback: async (input) => {
        config.add(input.name, input.transport);
        return toJsonValue({
          added: true,
          name: input.name,
          transport: input.transport,
        });
      },
    }),
    tool({
      name: "update_mcp_server",
      description:
        "Update an existing MCP server configuration in the local MCP config file.",
      inputSchema: NamedTransportSchema,
      callback: async (input) => {
        config.update(input.name, input.transport);
        return toJsonValue({
          updated: true,
          name: input.name,
          transport: input.transport,
        });
      },
    }),
    tool({
      name: "delete_mcp_server",
      description:
        "Delete an MCP server configuration from the local MCP config file.",
      inputSchema: z.object({
        name: z.string().min(1).describe("MCP server name to remove."),
      }),
      callback: async (input) => {
        config.remove(input.name);
        return toJsonValue({
          deleted: true,
          name: input.name,
        });
      },
    }),
  ];
}
