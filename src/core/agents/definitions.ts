export const BUILTIN_AGENT_KINDS = ["research", "plan"] as const;

export type AgentKind = (typeof BUILTIN_AGENT_KINDS)[number];

export type AgentConfig = {
  id: AgentKind;
  instructions: string;
  description: string;
  tools: readonly string[];
};

export type AgentDefinition = AgentConfig & {
  instructionsText: string;
};

export const BUILTIN_AGENT_CONFIGS: readonly AgentConfig[] = [
  {
    id: "research",
    instructions: "research.md",
    description: "Investigates sources and context before the parent acts.",
    tools: [
      "read_file",
      "read_multiple_files",
      "list_directory",
      "directory_tree",
      "search_files",
      "get_file_info",
      "fetch",
      "think",
    ],
  },
  {
    id: "plan",
    instructions: "plan.md",
    description: "Produces plans, tradeoffs, risks, and validation steps.",
    tools: [
      "read_file",
      "read_multiple_files",
      "list_directory",
      "directory_tree",
      "search_files",
      "get_file_info",
      "think",
    ],
  },
];
