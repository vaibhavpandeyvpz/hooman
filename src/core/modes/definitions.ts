import type { KnownSessionMode, SessionMode } from "./schema.js";

export type ModeDefinition = {
  id: KnownSessionMode;
  name: string;
  instructions: string;
  description: string;
  tools: "*" | readonly string[];
};

export const MODE_DEFINITIONS: readonly ModeDefinition[] = [
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
      "run_subagents",
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
      "run_subagents",
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
];

export function getModeDefinition(mode: SessionMode): ModeDefinition | null {
  if (!isModeDefinition(mode)) {
    return null;
  }
  return MODE_DEFINITIONS.find((entry) => entry.id === mode) ?? null;
}

export function getModeTools(
  mode: SessionMode,
): "*" | readonly string[] | null {
  return getModeDefinition(mode)?.tools ?? null;
}

export function isModeDefinition(mode: SessionMode): boolean {
  return MODE_DEFINITIONS.some((entry) => entry.id === mode);
}

export function getModeIds(): KnownSessionMode[] {
  return MODE_DEFINITIONS.map((entry) => entry.id);
}

export function getModeOptions(): Array<{
  value: KnownSessionMode;
  name: string;
  description: string;
}> {
  return MODE_DEFINITIONS.map((entry) => ({
    value: entry.id,
    name: entry.name,
    description: entry.description,
  }));
}

export function formatModeNames(): string {
  const ids = getModeIds();
  if (ids.length <= 1) {
    return ids[0] ?? "";
  }
  return `${ids.slice(0, -1).join(", ")}, or ${ids.at(-1)}`;
}
