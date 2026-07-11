import handlebars from "handlebars";
import type { Config } from "../config.js";
import { hasBundledPrompt, readBundledPrompt } from "../prompts/bundled.js";
import { getEnvironmentPromptContext } from "../prompts/environment.js";
import { MODE_DEFINITIONS, type ModeDefinition } from "./definitions.js";

const { compile } = handlebars;
const SECTION_BREAK = "\n\n---\n\n";

export type LoadedModeDefinition = Omit<ModeDefinition, "instructions"> & {
  instructions: string;
};

function filterKnownTools(
  definitions: readonly LoadedModeDefinition[],
  knownTools: readonly string[],
): LoadedModeDefinition[] {
  const known = new Set(knownTools);
  return definitions.map((definition) => ({
    ...definition,
    tools: definition.tools.filter((toolName) => known.has(toolName)),
  }));
}

function context(config: Config): Record<string, unknown> {
  return {
    name: config.name,
    llm: config.llm,
    environment: getEnvironmentPromptContext(),
    compaction: config.compaction,
  };
}

export function loadModeDefinitions(
  config: Config,
  options?: { knownTools?: readonly string[]; baseSystemPrompt?: string },
): LoadedModeDefinition[] {
  const definitions = MODE_DEFINITIONS.map((entry) => {
    if (!hasBundledPrompt(...entry.instructions.split("/"))) {
      throw new Error(
        `Mode '${entry.id}' instructions file not found: ${entry.instructions}`,
      );
    }
    const raw = readBundledPrompt(...entry.instructions.split("/"));
    if (!raw) {
      throw new Error(
        `Mode '${entry.id}' instructions file is empty: ${entry.instructions}`,
      );
    }
    const renderedInstructions = compile(raw)(context(config)).trim();
    const instructions = [
      options?.baseSystemPrompt?.trim(),
      renderedInstructions,
    ]
      .filter(Boolean)
      .join(SECTION_BREAK)
      .trim();
    if (!instructions) {
      throw new Error(
        `Mode '${entry.id}' instructions rendered to empty content.`,
      );
    }
    return {
      ...entry,
      instructions,
    };
  });
  if (options?.knownTools) {
    return filterKnownTools(definitions, options.knownTools);
  }
  return definitions;
}
