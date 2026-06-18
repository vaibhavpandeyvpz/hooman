import { Agent, BeforeInvocationEvent } from "@strands-agents/sdk";
import type { Tool } from "@strands-agents/sdk";
import { type Config } from "../config.js";
import { create as createContext } from "../context/index.js";
import { modelProviders } from "../models/index.js";
import type { Manager as McpManager } from "../mcp/index.js";
import type { System as SystemPrompt } from "../prompts/index.js";
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
  createWebSearchTools,
} from "../tools/index.js";
import {
  composeSystemPromptWithSessionMode,
  refreshAgentSystemPromptForSessionMode,
  registerAgentSystemPromptBaseBuilder,
} from "../prompts/session-mode-appendix.js";
import {
  createAgentSkillsPlugin,
} from "../skills/index.js";
import { ModeAwareToolRegistry } from "./mode-aware-tool-registry.js";
import { applySessionMode } from "./sync-tool-registry-mode.js";
import { clearTodoState } from "../state/todos.js";
import {
  MODE_STATE_KEY,
  normalizeSessionMode,
  type SessionMode,
} from "../state/session-mode.js";
import { YOLO_STATE_KEY } from "../state/yolo.js";

const SECTION_BREAK = "\n\n---\n\n";

export async function create(
  config: Config,
  system: SystemPrompt,
  mcp: { manager: McpManager },
  print: boolean = false,
  meta: {
    userId?: string;
    sessionId?: string;
    systemPrompt?: string;
    /** Auto-approve tools (CLI `--yolo`, ACP toggle); stored on {@link Agent.appState}. */
    yolo?: boolean;
    sessionMode?: SessionMode;
  },
): Promise<Agent> {
  const sessionId = meta.sessionId;
  const userId = meta.userId ?? sessionId;
  const llm = await modelProviders[config.llm.provider]!();
  const ctx = createContext(sessionId);
  const { plugins: contextPlugins = [], ...agentContext } = ctx;
  const prefixed = await mcp.manager.listPrefixedTools();
  const skillsPlugin = createAgentSkillsPlugin();

  async function buildBaseSystemPrompt(): Promise<string> {
    await system.reload();
    const appendNext = await mcp.manager.listServerInstructions();
    return [system.content, meta.systemPrompt, ...appendNext]
      .filter(Boolean)
      .join(SECTION_BREAK);
  }

  const base = await buildBaseSystemPrompt();
  const mode = normalizeSessionMode(meta.sessionMode);
  const prompt = composeSystemPromptWithSessionMode(base, mode, {});
  const model = llm.create(config.llm.model, config.llm.params);

  const tools: Tool[] = [
    ...createByeTools(),
    ...createTimeTools(),
    ...(config.tools.sleep.enabled ? createSleepTools() : []),
    ...(config.tools.todo.enabled ? createTodoTools() : []),
    ...(config.tools.fetch.enabled ? createFetchTools() : []),
    ...(config.tools.filesystem.enabled ? createFilesystemTools() : []),
    ...(config.tools.shell.enabled ? createShellTools() : []),
    ...(config.search.enabled ? createWebSearchTools(config) : []),
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
      ...(meta.yolo ? { [YOLO_STATE_KEY]: true } : {}),
      ...(meta.sessionMode ? { [MODE_STATE_KEY]: meta.sessionMode } : {}),
    },
    plugins: [skillsPlugin, ...contextPlugins],
    tools,
    printer: print,
    ...agentContext,
  });
  agent.addHook(BeforeInvocationEvent, async (event) => {
    clearTodoState(event.agent);
    refreshAgentSystemPromptForSessionMode(
      event.agent,
      await buildBaseSystemPrompt(),
    );
  });
  registerAgentSystemPromptBaseBuilder(agent, buildBaseSystemPrompt);
  (agent as unknown as { _toolRegistry: ModeAwareToolRegistry })._toolRegistry =
    new ModeAwareToolRegistry(agent.toolRegistry.list());
  await agent.initialize();
  applySessionMode(agent);
  return agent;
}
