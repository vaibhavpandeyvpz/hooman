import type { SessionMode } from "../state/session-mode.js";

export type AgentConfig = {
  id: "agent" | "research" | "ask" | "plan";
  name: string;
  instructions: string;
  description: string;
  tools: "*" | readonly string[];
};

export type AgentDefinition = AgentConfig & {
  instructionsText: string;
};

export const BUILTIN_AGENT_CONFIGS: readonly AgentConfig[] = [
  {
    id: "agent",
    name: "Agent",
    instructions: "modes/agent.md",
    description: "fully-feature agent surface",
    tools: "*",
  },
  {
    id: "plan",
    name: "Plan",
    instructions: "modes/plan.md",
    description: "plan a larger piece of work to execute later",
    tools: [
      "fetch",
      "web_search",
      "skills",
      "retrieve_offloaded_content",
      "search_memory",
      "strands_structured_output",
      "update_todos",
      "think",
      "run_agents",
      "sleep",
      "bye",
      "convert_time",
      "get_current_time",
      "directory_tree",
      "get_file_info",
      "list_directory",
      "search_files",
      "read_file",
      "read_multiple_files",
      "write_file",
      "edit_file",
      "enter_plan_mode",
      "exit_plan_mode",
    ],
  },
  {
    id: "ask",
    name: "Ask",
    instructions: "modes/ask.md",
    description: "read-only tool surface for questions and answers",
    tools: [
      "fetch",
      "web_search",
      "skills",
      "retrieve_offloaded_content",
      "search_memory",
      "strands_structured_output",
      "update_todos",
      "think",
      "run_agents",
      "sleep",
      "bye",
      "convert_time",
      "get_current_time",
      "directory_tree",
      "get_file_info",
      "list_directory",
      "search_files",
      "read_file",
      "read_multiple_files",
      "write_file",
      "edit_file",
    ],
  },
  {
    id: "research",
    name: "Research",
    instructions: "modes/research.md",
    description: "explores the workspace to gather inforamtion",
    tools: [
      "read_file",
      "read_multiple_files",
      "list_directory",
      "directory_tree",
      "search_files",
      "get_file_info",
      "fetch",
      "web_search",
      "think",
    ],
  },
];

export function getBuiltInAgentConfig(mode: SessionMode): AgentConfig | null {
  if (!isBuiltInAgentId(mode)) {
    return null;
  }
  return BUILTIN_AGENT_CONFIGS.find((entry) => entry.id === mode) ?? null;
}

export function getBuiltInAgentTools(
  mode: SessionMode,
): "*" | readonly string[] | null {
  return getBuiltInAgentConfig(mode)?.tools ?? null;
}

export function isBuiltInAgentId(mode: SessionMode): boolean {
  return BUILTIN_AGENT_CONFIGS.some((entry) => entry.id === mode);
}
