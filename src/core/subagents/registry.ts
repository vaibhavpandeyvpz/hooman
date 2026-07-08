import handlebars from "handlebars";
import type { Config } from "../config.js";
import { hasBundledPrompt, readBundledPrompt } from "../prompts/bundled.js";
import { getEnvironmentPromptContext } from "../prompts/environment.js";

const { compile } = handlebars;
const SECTION_BREAK = "\n\n---\n\n";

export type SubagentKindConfig = {
  id: string;
  name: string;
  promptPath: string;
  description: string;
  allowedTools: readonly string[];
  readOnly: boolean;
  inheritBasePrompt: boolean;
};

export type SubagentKindDefinition = Omit<SubagentKindConfig, "promptPath"> & {
  promptPath: string;
  instructions: string;
};

export type SubagentRegistry = {
  kinds: readonly SubagentKindDefinition[];
  byId: ReadonlyMap<string, SubagentKindDefinition>;
};

const DEFAULT_ALLOWED_TOOLS = [
  "read_file",
  "read_multiple_files",
  "list_directory",
  "directory_tree",
  "grep",
  "get_file_info",
  "fetch",
  "web_search",
  "think",
] as const;

const BUILTIN_SUBAGENT_KINDS: readonly SubagentKindConfig[] = [
  {
    id: "research",
    name: "Research",
    promptPath: "agents/research.md",
    description: "explores the workspace to gather information",
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    readOnly: true,
    inheritBasePrompt: true,
  },
  {
    id: "review",
    name: "Review",
    promptPath: "agents/review.md",
    description: "reviews code, changes, and plans for risks and regressions",
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    readOnly: true,
    inheritBasePrompt: true,
  },
  {
    id: "test-investigator",
    name: "Test Investigator",
    promptPath: "agents/test-investigator.md",
    description: "investigates test/build behaviors and likely failure causes",
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    readOnly: true,
    inheritBasePrompt: true,
  },
];

function promptContext(config: Config): Record<string, unknown> {
  return {
    name: config.name,
    llm: config.llm,
    environment: getEnvironmentPromptContext(),
    compaction: config.compaction,
  };
}

function renderInstructions(
  config: Config,
  kind: SubagentKindConfig,
  baseSystemPrompt?: string,
): string {
  if (!hasBundledPrompt(...kind.promptPath.split("/"))) {
    throw new Error(
      `Subagent '${kind.id}' instructions file not found: ${kind.promptPath}`,
    );
  }
  const raw = readBundledPrompt(...kind.promptPath.split("/"));
  if (!raw) {
    throw new Error(
      `Subagent '${kind.id}' instructions file is empty: ${kind.promptPath}`,
    );
  }
  const rendered = compile(raw)(promptContext(config)).trim();
  const sections = kind.inheritBasePrompt
    ? [baseSystemPrompt?.trim(), rendered]
    : [rendered];
  const instructions = sections.filter(Boolean).join(SECTION_BREAK).trim();
  if (!instructions) {
    throw new Error(
      `Subagent '${kind.id}' instructions rendered to empty content.`,
    );
  }
  return instructions;
}

export function createSubagentRegistry(
  config: Config,
  options?: { knownTools?: readonly string[]; systemPrompt?: string },
): SubagentRegistry {
  const knownTools = options?.knownTools;
  const kinds = BUILTIN_SUBAGENT_KINDS.map((kind) => {
    const filteredTools = knownTools
      ? kind.allowedTools.filter((toolName) => knownTools.includes(toolName))
      : [...kind.allowedTools];
    return {
      ...kind,
      allowedTools: filteredTools,
      instructions: renderInstructions(config, kind, options?.systemPrompt),
    };
  });
  const byId = new Map<string, SubagentKindDefinition>();
  for (const kind of kinds) {
    if (byId.has(kind.id)) {
      throw new Error(`Duplicate subagent kind id '${kind.id}'.`);
    }
    byId.set(kind.id, kind);
  }
  return {
    kinds,
    byId,
  };
}
