import { Agent } from "@strands-agents/sdk";
import type { Config, LlmProvider } from "../config.ts";
import type { ModelProvider } from "../models";
import { modelProviders } from "../models";
import {
  type Config as McpConfig,
  type Manager as McpManager,
  createMcpTools,
} from "../mcp";
import type { System as SystemPrompt } from "../prompts";
import { skills as createSkillsPrompt } from "../prompts";
import {
  createShortTermMemory,
  createLongTermMemoryStore,
  createLongTermMemoryTools,
} from "../memory";
import type { Registry } from "../skills";
import { createSkillsTools } from "../skills";
import {
  createFetchTools,
  createFilesystemTools,
  createShellTools,
  createThinkingTools,
  createTimeTools,
} from "../tools";

const SECTION_BREAK = "\n\n---\n\n";

export async function create(
  userId: string,
  sessionId: string,
  config: Config,
  system: SystemPrompt,
  registry: Registry,
  mcp: { config: McpConfig; manager: McpManager },
  print: boolean = false,
): Promise<Agent> {
  const llm = await modelProviders[config.llm.provider]!();
  const stm = createShortTermMemory(sessionId);
  const ltm = createLongTermMemoryStore(config);
  const skills = await createSkillsPrompt(registry);
  const tools = await mcp.manager.listPrefixedTools();
  const prompt = [system.content, skills.content]
    .filter((x) => !!x)
    .join(SECTION_BREAK);
  return new Agent({
    name: config.name,
    systemPrompt: prompt,
    model: llm.create(config.llm.model, config.llm.params),
    appState: {
      userId,
      sessionId,
    },
    tools: [
      ...createTimeTools(),
      ...createFilesystemTools(),
      ...createShellTools(),
      ...createFetchTools(),
      ...createThinkingTools(),
      ...createLongTermMemoryTools(ltm),
      ...createSkillsTools(registry),
      ...createMcpTools(mcp.config),
      ...tools,
    ],
    printer: print,
    ...stm,
  });
}
