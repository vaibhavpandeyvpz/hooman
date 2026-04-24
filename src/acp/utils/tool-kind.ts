import type { ToolKind } from "@agentclientprotocol/sdk";
import type { Tool } from "@strands-agents/sdk";

const INTERNAL_ALWAYS_ALLOWED = new Set(["strands_structured_output"]);
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
  ["fetch", "fetch"],
  ["wiki_list_files", "read"],
  ["wiki_read_file", "read"],
  ["wiki_write_file", "edit"],
  ["wiki_knowledge_graph", "read"],
  ["wiki_stats", "read"],
  ["wiki_search", "search"],
  ["think", "think"],
  ["get_current_time", "other"],
  ["convert_time", "other"],
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
