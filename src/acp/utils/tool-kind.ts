import type { ToolKind } from "@agentclientprotocol/sdk";
import type { Tool } from "@strands-agents/sdk";
import { INTERNAL_ALWAYS_ALLOWED } from "../../core/approvals/allowed-tools.ts";

const KNOWN_TOOL_KINDS = new Map<string, ToolKind>([
  ["read_file", "read"],
  ["read_multiple_files", "read"],
  ["write_file", "edit"],
  ["edit_file", "edit"],
  ["create_directory", "edit"],
  ["list_directory", "read"],
  ["directory_tree", "read"],
  ["move_file", "move"],
  ["search_files", "search"],
  ["get_file_info", "read"],
  ["shell", "execute"],
  ["sleep", "other"],
  ["fetch", "fetch"],
  ["wiki_list_files", "read"],
  ["wiki_read_file", "read"],
  ["wiki_write_file", "edit"],
  ["wiki_knowledge_graph", "read"],
  ["wiki_stats", "read"],
  ["wiki_search", "search"],
  ["web_search", "search"],
  ["think", "think"],
  ["run_agents", "other"],
  ["update_todos", "other"],
  ["get_current_time", "other"],
  ["convert_time", "other"],
  ["list_skills", "read"],
  ["search_skills", "search"],
  ["install_skill", "edit"],
  ["delete_skill", "edit"],
  ["store_memory", "edit"],
  ["search_memory", "search"],
  ["update_memory", "edit"],
  ["archive_memory", "edit"],
  ["list_mcp_servers", "read"],
  ["get_mcp_server", "read"],
  ["add_mcp_server", "edit"],
  ["update_mcp_server", "edit"],
  ["delete_mcp_server", "edit"],
]);

export { INTERNAL_ALWAYS_ALLOWED };

export function inferToolKind(toolName: string): ToolKind {
  return KNOWN_TOOL_KINDS.get(toolName) ?? "other";
}

export function toolDisplayTitle(
  toolName: string,
  tool: Tool | undefined,
): string {
  const desc = tool?.description?.trim();
  if (desc && desc.length <= 120) {
    return `${toolName}: ${desc}`;
  }
  return toolName;
}
