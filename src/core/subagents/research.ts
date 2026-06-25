import handlebars from "handlebars";
import type { Config } from "../config.js";
import { hasBundledPrompt, readBundledPrompt } from "../prompts/bundled.js";
import { getEnvironmentPromptContext } from "../prompts/environment.js";

const { compile } = handlebars;
const SECTION_BREAK = "\n\n---\n\n";

export type ResearchSubagentConfig = {
  id: "research";
  name: string;
  instructions: string;
  description: string;
  tools: readonly string[];
};

export type ResearchSubagentDefinition = Omit<
  ResearchSubagentConfig,
  "instructions"
> & {
  instructions: string;
};

export const RESEARCH_SUBAGENT: ResearchSubagentConfig = {
  id: "research",
  name: "Research",
  instructions: "agents/research.md",
  description: "explores the workspace to gather information",
  tools: [
    "read_file",
    "read_multiple_files",
    "list_directory",
    "directory_tree",
    "grep",
    "get_file_info",
    "fetch",
    "web_search",
    "think",
  ],
};

function promptContext(config: Config): Record<string, unknown> {
  return {
    name: config.name,
    llm: config.llm,
    environment: getEnvironmentPromptContext(),
    compaction: config.compaction,
  };
}

export function loadResearchSubagent(
  config: Config,
  options?: { knownTools?: readonly string[]; baseSystemPrompt?: string },
): ResearchSubagentDefinition {
  const entry = RESEARCH_SUBAGENT;
  const knownTools = options?.knownTools;
  if (!hasBundledPrompt(...entry.instructions.split("/"))) {
    throw new Error(
      `Subagent '${entry.id}' instructions file not found: ${entry.instructions}`,
    );
  }

  const raw = readBundledPrompt(...entry.instructions.split("/"));
  if (!raw) {
    throw new Error(
      `Subagent '${entry.id}' instructions file is empty: ${entry.instructions}`,
    );
  }

  const renderedInstructions = compile(raw)(promptContext(config)).trim();
  const instructions = [options?.baseSystemPrompt?.trim(), renderedInstructions]
    .filter(Boolean)
    .join(SECTION_BREAK)
    .trim();

  if (!instructions) {
    throw new Error(
      `Subagent '${entry.id}' instructions rendered to empty content.`,
    );
  }

  const tools = knownTools
    ? entry.tools.filter((toolName) => knownTools.includes(toolName))
    : [...entry.tools];

  return {
    ...entry,
    instructions,
    tools,
  };
}
