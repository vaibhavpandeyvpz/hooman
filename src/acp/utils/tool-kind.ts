import type { ToolKind } from "@agentclientprotocol/sdk";
import type { Tool } from "@strands-agents/sdk";
import {
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
  INTERNAL_ALWAYS_ALLOWED,
} from "../../core/state/tool-approvals.js";

const KNOWN_TOOL_KINDS = new Map<string, ToolKind>([
  ["read_file", "read"],
  ["read_multiple_files", "read"],
  ["write_file", "edit"],
  ["edit_file", "edit"],
  ["create_directory", "edit"],
  ["list_directory", "read"],
  ["directory_tree", "read"],
  ["move_file", "move"],
  ["grep", "search"],
  ["get_file_info", "read"],
  ["shell", "execute"],
  ["sleep", "other"],
  ["fetch", "fetch"],
  ["web_search", "search"],
  ["skills", "other"],
  ["retrieve_offloaded_content", "read"],
  ["search_memory", "search"],
  ["strands_structured_output", "other"],
  ["think", "think"],
  ["subagent_research", "other"],
  ["subagent_review", "other"],
  ["subagent_test_investigator", "other"],
  ["update_todos", "other"],
  ["ask_user", "other"],
  ["get_current_time", "other"],
  ["convert_time", "other"],
  [ENTER_PLAN_MODE_TOOL, "switch_mode"],
  [EXIT_PLAN_MODE_TOOL, "switch_mode"],
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
