import { Agent, BeforeInvocationEvent } from "@strands-agents/sdk";
import type { Tool } from "@strands-agents/sdk";
import type { Config } from "../config.ts";
import { modelProviders } from "../models";
import {
  createMcpTools,
  type Config as McpConfig,
  type Manager as McpManager,
} from "../mcp";
import type { System as SystemPrompt } from "../prompts";
import { skills as createSkillsPrompt } from "../prompts";
import {
  createShortTermMemory,
  createLongTermMemoryStore,
  createLongTermMemoryTools,
} from "../memory";
import { createSkillsTools, type Registry } from "../skills";
import {
  createRunAgentsTools,
  loadBuiltInAgentDefinitions,
} from "../agents/index.ts";
import {
  createTodoTools,
  createFetchTools,
  createFilesystemTools,
  createSleepTools,
  createShellTools,
  createThinkingTools,
  createTimeTools,
  createWikiTools,
  createWebSearchTools,
} from "../tools";
import { clearTodoState } from "../tools/todo.ts";

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
  const ltm = config.tools.ltm.enabled
    ? createLongTermMemoryStore(config)
    : null;
  const skills = (await createSkillsPrompt(registry)).content;
  const prefixed = await mcp.manager.listPrefixedTools();
  const append = await mcp.manager.listServerInstructions();
  const prompt = [system.content, meta.systemPrompt, ...append, skills]
    .filter((x) => !!x)
    .join(SECTION_BREAK);
  const model = llm.create(config.llm.model, config.llm.params);
  const tools: Tool[] = [
    ...createTimeTools(),
    ...(config.tools.sleep.enabled ? createSleepTools() : []),
    ...(config.tools.todo.enabled ? createTodoTools() : []),
    ...(config.tools.fetch.enabled ? createFetchTools() : []),
    ...(ltm ? createLongTermMemoryTools(ltm) : []),
    ...(config.tools.filesystem.enabled ? createFilesystemTools() : []),
    ...(config.tools.shell.enabled ? createShellTools() : []),
    ...(config.search.enabled ? createWebSearchTools(config) : []),
    ...(config.tools.wiki.enabled ? createWikiTools(config) : []),
    ...(config.tools.mcp.enabled ? createMcpTools(mcp.config) : []),
    ...(config.tools.skills.enabled ? createSkillsTools(registry) : []),
    ...createThinkingTools(),
    ...prefixed,
  ];
  if (config.tools.agents.enabled) {
    const definitions = loadBuiltInAgentDefinitions(config, {
      knownTools: tools.map((entry) => entry.name),
    });
    tools.push(
      ...createRunAgentsTools({
        parent: config.name,
        definitions,
        tools,
        createModel: () => llm.create(config.llm.model, config.llm.params),
        defaultConcurrency: config.tools.agents.concurrency,
      }),
    );
  }
  const agent = new Agent({
    name: config.name,
    systemPrompt: prompt,
    model,
    appState: {
      ...(userId ? { userId } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
    tools,
    printer: print,
    ...stm,
  });
  agent.addHook(BeforeInvocationEvent, async (event) => {
    clearTodoState(event.agent);
  });
  return agent;
}
