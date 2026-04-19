import { Agent } from "@strands-agents/sdk";
import type { Config } from "../config.ts";
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
import { toolkitAtLeast } from "../toolkit.ts";
import type { Toolkit } from "../toolkit.ts";

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
    toolkit?: Toolkit;
  },
): Promise<Agent> {
  const sessionId = meta.sessionId;
  const userId = meta.userId ?? sessionId;
  const toolkit = meta.toolkit ?? "full";
  const llm = await modelProviders[config.llm.provider]!();
  const stm = createShortTermMemory(sessionId);
  const ltm = config.ltm.enabled ? createLongTermMemoryStore(config) : null;
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
      ...createFetchTools(),
      ...(ltm ? createLongTermMemoryTools(ltm) : []),
      ...(toolkitAtLeast(toolkit, "full") ? createFilesystemTools() : []), // > lite
      ...(toolkitAtLeast(toolkit, "full") ? createShellTools() : []),
      ...(toolkitAtLeast(toolkit, "full") ? createThinkingTools() : []),
      ...(toolkit === "max" ? createSkillsTools(registry) : []),
      ...(toolkit === "max" ? createMcpTools(mcp.config) : []),
      ...tools,
    ],
    printer: print,
    ...stm,
  });
}
