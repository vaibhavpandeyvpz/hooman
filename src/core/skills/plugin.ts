import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JSONValue, LocalAgent } from "@strands-agents/sdk";
import {
  AgentSkills,
  type SkillSource,
} from "@strands-agents/sdk/vended-plugins/skills";
import { skillsPath } from "../utils/paths.js";

export const AGENT_SKILLS_STATE_KEY = "hooman.agentSkills";

export function builtInSkillsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "./built-in");
}

export function createAgentSkillSources(): SkillSource[] {
  const sources: SkillSource[] = [];
  const bundled = builtInSkillsPath();
  if (existsSync(bundled)) {
    sources.push(bundled);
  }

  const installed = skillsPath();
  if (existsSync(installed)) {
    sources.push(installed);
  }

  return sources;
}

export function createAgentSkillsPlugin(): AgentSkills {
  return new AgentSkills({
    skills: createAgentSkillSources(),
    stateKey: AGENT_SKILLS_STATE_KEY,
  });
}

export function clearAgentSkillsPromptInjectionState(
  agent: LocalAgent,
): void {
  const value = agent.appState.get(AGENT_SKILLS_STATE_KEY);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }

  const next = { ...value } as Record<string, JSONValue>;
  if (!Object.prototype.hasOwnProperty.call(next, "lastInjectedXml")) {
    return;
  }

  delete next.lastInjectedXml;
  agent.appState.set(AGENT_SKILLS_STATE_KEY, next);
}
