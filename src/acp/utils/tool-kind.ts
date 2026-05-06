import type { ToolKind } from "@agentclientprotocol/sdk";
import type { Tool } from "@strands-agents/sdk";
import { INTERNAL_ALWAYS_ALLOWED } from "../../core/state/tool-approvals.js";

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
  ["bye", "other"],
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
  ["memory_store", "edit"],
  ["memory_search", "search"],
  ["memory_update", "edit"],
  ["memory_archive", "edit"],
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
