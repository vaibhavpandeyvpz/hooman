export const BUILTIN_AGENT_KINDS = ["research"] as const;

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
    description:
      "Explores the workspace and sources, gathers evidence and context so the parent agent can act with confidence.",
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
