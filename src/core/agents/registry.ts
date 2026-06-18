import handlebars from "handlebars";
import type { Config } from "../config.js";
import { hasBundledPrompt, readBundledPrompt } from "../prompts/bundled.js";
import { getEnvironmentPromptContext } from "../prompts/environment.js";
import {
  BUILTIN_AGENT_CONFIGS,
  type AgentConfig,
  type AgentDefinition,
} from "./definitions.js";

const { compile } = handlebars;
const SECTION_BREAK = "\n\n---\n\n";

function validateConfigs(configs: readonly AgentConfig[]): void {
  const seen = new Set<string>();
  for (const config of configs) {
    if (!config.id.trim()) {
      throw new Error("Agent config id cannot be empty.");
    }
    if (seen.has(config.id)) {
      throw new Error(`Duplicate agent config id: '${config.id}'.`);
    }
    seen.add(config.id);
    if (!config.name.trim()) {
      throw new Error(`Agent '${config.id}' name cannot be empty.`);
    }
    if (!config.instructions.trim()) {
      throw new Error(
        `Agent '${config.id}' instructions file cannot be empty.`,
      );
    }
    if (!config.description.trim()) {
      throw new Error(`Agent '${config.id}' description cannot be empty.`);
    }
    if (config.tools !== "*") {
      if (!Array.isArray(config.tools)) {
        throw new Error(`Agent '${config.id}' tools must be an array.`);
      }
      for (const toolName of config.tools) {
        if (!toolName.trim()) {
          throw new Error(`Agent '${config.id}' has an empty tool name.`);
        }
      }
    }
  }
}

function filterKnownTools(
  definitions: readonly AgentDefinition[],
  knownTools: readonly string[],
): AgentDefinition[] {
  const known = new Set(knownTools);
  return definitions.map((definition) => {
    const tools =
      definition.tools !== "*"
        ? definition.tools.filter((toolName) => known.has(toolName))
        : knownTools;
    return {
      ...definition,
      tools,
    };
  });
}

function context(config: Config): Record<string, unknown> {
  return {
    name: config.name,
    llm: config.llm,
    environment: getEnvironmentPromptContext(),
    compaction: config.compaction,
  };
}

export function loadBuiltInAgentDefinitions(
  config: Config,
  options?: { knownTools?: readonly string[]; baseSystemPrompt?: string },
): AgentDefinition[] {
  validateConfigs(BUILTIN_AGENT_CONFIGS);
  const definitions = BUILTIN_AGENT_CONFIGS.map((entry) => {
    if (!hasBundledPrompt(...entry.instructions.split("/"))) {
      throw new Error(
        `Agent '${entry.id}' instructions file not found: ${entry.instructions}`,
      );
    }
    const raw = readBundledPrompt(...entry.instructions.split("/"));
    if (!raw) {
      throw new Error(
        `Agent '${entry.id}' instructions file is empty: ${entry.instructions}`,
      );
    }
    const renderedInstructions = compile(raw)(context(config)).trim();
    const instructionsText = [
      options?.baseSystemPrompt?.trim(),
      renderedInstructions,
    ]
      .filter(Boolean)
      .join(SECTION_BREAK)
      .trim();
    if (!instructionsText) {
      throw new Error(
        `Agent '${entry.id}' instructions rendered to empty content.`,
      );
    }
    return {
      ...entry,
      instructionsText,
    };
  });
  if (options?.knownTools) {
    return filterKnownTools(definitions, options.knownTools);
  }
  return definitions;
}
