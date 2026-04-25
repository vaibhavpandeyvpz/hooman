import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "handlebars";
import type { Config } from "../config.ts";
import { getEnvironmentPromptContext } from "../prompts/environment.ts";
import {
  BUILTIN_AGENT_CONFIGS,
  type AgentConfig,
  type AgentDefinition,
} from "./definitions.ts";

function promptsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../prompts/agents");
}

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
    if (!config.instructions.trim()) {
      throw new Error(
        `Agent '${config.id}' instructions file cannot be empty.`,
      );
    }
    if (!config.description.trim()) {
      throw new Error(`Agent '${config.id}' description cannot be empty.`);
    }
    if (!Array.isArray(config.tools) || config.tools.length === 0) {
      throw new Error(`Agent '${config.id}' must declare at least one tool.`);
    }
    for (const toolName of config.tools) {
      if (!toolName.trim()) {
        throw new Error(`Agent '${config.id}' has an empty tool name.`);
      }
    }
  }
}

function assertKnownTools(
  definitions: readonly AgentDefinition[],
  knownTools: readonly string[],
): void {
  const known = new Set(knownTools);
  for (const definition of definitions) {
    for (const toolName of definition.tools) {
      if (!known.has(toolName)) {
        throw new Error(
          `Agent '${definition.id}' references unknown tool '${toolName}'.`,
        );
      }
    }
  }
}

function context(config: Config): Record<string, unknown> {
  return {
    name: config.name,
    llm: config.llm,
    environment: getEnvironmentPromptContext(),
    ltm: config.tools.ltm,
    wiki: config.tools.wiki,
    compaction: config.compaction,
  };
}

export function loadBuiltInAgentDefinitions(
  config: Config,
  options?: { knownTools?: readonly string[] },
): AgentDefinition[] {
  validateConfigs(BUILTIN_AGENT_CONFIGS);
  const dir = promptsDir();
  const definitions = BUILTIN_AGENT_CONFIGS.map((entry) => {
    const fullPath = join(dir, entry.instructions);
    if (!existsSync(fullPath)) {
      throw new Error(
        `Agent '${entry.id}' instructions file not found: ${entry.instructions}`,
      );
    }
    const raw = readFileSync(fullPath, "utf8").trim();
    if (!raw) {
      throw new Error(
        `Agent '${entry.id}' instructions file is empty: ${entry.instructions}`,
      );
    }
    const template = compile(raw);
    const instructionsText = template(context(config)).trim();
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
    assertKnownTools(definitions, options.knownTools);
  }
  return definitions;
}
