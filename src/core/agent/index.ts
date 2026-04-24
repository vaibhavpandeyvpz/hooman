import { Agent } from "@strands-agents/sdk";
import type { Config } from "../config.ts";
import { modelProviders } from "../models";
import { type Config as McpConfig, type Manager as McpManager } from "../mcp";
import type { System as SystemPrompt } from "../prompts";
import { skills as createSkillsPrompt } from "../prompts";
import {
  createShortTermMemory,
  createLongTermMemoryStore,
  createLongTermMemoryTools,
} from "../memory";
import type { Registry } from "../skills";
import {
  createFetchTools,
  createFilesystemTools,
  createShellTools,
  createThinkingTools,
  createTimeTools,
  createWikiTools,
} from "../tools";

const SECTION_BREAK = "\n\n---\n\n";

export async function create(
  config: Config,
  system: SystemPrompt,
  registry: Registry,
  mcp: { config: McpConfig; manager: McpManager },
  print: boolean = false,
  meta: {
    userId?: string;
    sessionId?: string;
    systemPrompt?: string;
  },
): Promise<Agent> {
  const sessionId = meta.sessionId;
  const userId = meta.userId ?? sessionId;
  const llm = await modelProviders[config.llm.provider]!();
  const stm = createShortTermMemory(sessionId);
  const ltm = config.features.ltm.enabled
    ? createLongTermMemoryStore(config)
    : null;
  const skills = await createSkillsPrompt(registry);
  const tools = await mcp.manager.listPrefixedTools();
  const append = await mcp.manager.listServerInstructions();
  const prompt = [system.content, meta.systemPrompt, ...append, skills.content]
    .filter((x) => !!x)
    .join(SECTION_BREAK);
  return new Agent({
    name: config.name,
    systemPrompt: prompt,
    model: llm.create(config.llm.model, config.llm.params),
    appState: {
      ...(userId ? { userId } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
    tools: [
      ...createTimeTools(),
      ...(config.features.fetch.enabled ? createFetchTools() : []),
      ...(ltm ? createLongTermMemoryTools(ltm) : []),
      ...(config.features.filesystem.enabled ? createFilesystemTools() : []),
      ...(config.features.shell.enabled ? createShellTools() : []),
      ...(config.features.wiki.enabled ? createWikiTools(config) : []),
      ...createThinkingTools(),
      ...tools,
    ],
    printer: print,
    ...stm,
  });
}
