import { Agent, BeforeInvocationEvent } from "@strands-agents/sdk";
import type { Tool } from "@strands-agents/sdk";
import type { Config } from "../config.js";
import { modelProviders } from "../models/index.js";
import type { Manager as McpManager } from "../mcp/index.js";
import type { System as SystemPrompt } from "../prompts/index.js";
import { skills as createSkillsPrompt } from "../prompts/index.js";
import {
  createShortTermMemory,
  createLongTermMemoryStore,
  createLongTermMemoryTools,
} from "../memory/index.js";
import type { Registry } from "../skills/index.js";
import {
  createRunAgentsTools,
  loadBuiltInAgentDefinitions,
} from "../agents/index.js";
import {
  createByeTools,
  createTodoTools,
  createFetchTools,
  createFilesystemTools,
  createPlanTools,
  createSleepTools,
  createShellTools,
  createThinkingTools,
  createTimeTools,
  createWikiTools,
  createWebSearchTools,
} from "../tools/index.js";
import { ModeAwareToolRegistry } from "./mode-aware-tool-registry.js";
import { applySessionMode } from "./sync-tool-registry-mode.js";
import { clearTodoState } from "../state/todos.js";

const SECTION_BREAK = "\n\n---\n\n";

export async function create(
  config: Config,
  system: SystemPrompt,
  registry: Registry,
  mcp: { manager: McpManager },
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
    ...createByeTools(),
    ...createTimeTools(),
    ...(config.tools.sleep.enabled ? createSleepTools() : []),
    ...(config.tools.todo.enabled ? createTodoTools() : []),
    ...(config.tools.fetch.enabled ? createFetchTools() : []),
    ...(ltm ? createLongTermMemoryTools(ltm) : []),
    ...(config.tools.filesystem.enabled ? createFilesystemTools() : []),
    ...(config.tools.shell.enabled ? createShellTools() : []),
    ...(config.search.enabled ? createWebSearchTools(config) : []),
    ...(config.tools.wiki.enabled ? createWikiTools(config) : []),
    ...createThinkingTools(),
    ...createPlanTools(),
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
  (agent as unknown as { _toolRegistry: ModeAwareToolRegistry })._toolRegistry =
    new ModeAwareToolRegistry(agent.toolRegistry.list());
  await agent.initialize();
  applySessionMode(agent);
  return agent;
}
