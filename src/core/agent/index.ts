import {
  Agent,
  BeforeInvocationEvent,
  HookOrder,
  IntervalTrigger,
  SessionManager,
  SummarizingConversationManager,
  type ConversationManager,
  type Plugin,
  type InterventionHandler,
} from "@strands-agents/sdk";
import { ContextOffloader } from "@strands-agents/sdk/vended-plugins/context-offloader";
import type { Tool } from "@strands-agents/sdk";
import { type Config } from "../config.js";
import { FileMemoryStore } from "../memory/index.js";
import { ToolBasedModelExtractor } from "../memory/model-extractor.js";
import { modelProviders, type ModelProvider } from "../models/index.js";
import { HoomanDefaultModelRetryStrategy } from "./default-retry-strategy.js";
import type { Manager as McpManager } from "../mcp/index.js";
import type { System as SystemPrompt } from "../prompts/index.js";
import { FlatFileStorage } from "../sessions/flat-file-storage.js";
import { LazySessionManager } from "../sessions/lazy-session-manager.js";
import { TolerantFileStorage } from "../sessions/tolerant-file-storage.js";
import {
  createSubagentTools,
  createSubagentRegistry,
} from "../subagents/index.js";
import {
  createAskUserTools,
  createTodoTools,
  createFetchTools,
  createFilesystemTools,
  createGrepTools,
  clearReadTimeAgentInstructionState,
  createPlanTools,
  createSleepTools,
  createShellTools,
  createThinkingTools,
  createTimeTools,
  createWebSearchTools,
  createMcpDiscoveryTools,
} from "../tools/index.js";
import { createSessionModePromptPlugin } from "../prompts/session-mode-appendix.js";
import {
  clearAgentSkillsPromptInjectionState,
  createAgentSkillsPlugin,
} from "../skills/index.js";
import { createPromptCachePlugin } from "./prompt-cache-plugin.js";
import { createGitignoreGuardPlugin } from "./gitignore-guard-plugin.js";
import {
  createSessionTitlePlugin,
  type SessionTitleCallback,
} from "./session-title-plugin.js";
import { LazyToolRegistry } from "./lazy-tool-registry.js";
import { clearTodoState } from "../state/todos.js";
import { MODE_STATE_KEY, type SessionMode } from "../state/session-mode.js";
import { PrefixedMcpTool } from "../mcp/prefixed-mcp-tool.js";
import { YOLO_STATE_KEY } from "../state/yolo.js";
import {
  memoryPath,
  offloadedContentPath,
  sessionsPath,
} from "../utils/paths.js";

const SECTION_BREAK = "\n\n---\n\n";
const OFFLOADING_MAX_RESULT_TOKENS = 5_000;
const OFFLOADING_PREVIEW_TOKENS = 2_000;
const MEMORY_STORE_NAME = "long_term";
const MEMORY_EXTRACTION_TURNS = 5;
const MEMORY_MAX_SEARCH_RESULTS = 5;
const agentConversationManagers = new WeakMap<Agent, ConversationManager>();
const agentSessionManagers = new WeakMap<Agent, SessionManager>();

type ToolRegistryContext = {
  config: Config;
  systemPrompt: string;
  createModel: () => ReturnType<ModelProvider["create"]>;
  manager: McpManager;
};

async function createToolRegistry({
  config,
  systemPrompt,
  createModel,
  manager,
}: ToolRegistryContext): Promise<{
  tools: Tool[];
  registry: LazyToolRegistry;
}> {
  const tools: Tool[] = [
    ...createTimeTools(),
    ...(config.tools.sleep.enabled ? createSleepTools() : []),
    ...(config.tools.todo.enabled ? createTodoTools() : []),
    ...(config.tools.fetch.enabled ? createFetchTools() : []),
    ...(config.tools.filesystem.enabled ? createFilesystemTools() : []),
    ...(config.tools.filesystem.enabled ? createGrepTools() : []),
    ...(config.tools.shell.enabled ? createShellTools() : []),
    ...(config.search.enabled ? createWebSearchTools(config) : []),
    ...createAskUserTools(),
    ...createThinkingTools(),
    ...createPlanTools(),
  ];

  const registry = new LazyToolRegistry(tools);
  const discoveryTools = createMcpDiscoveryTools(registry);
  tools.push(...discoveryTools);
  registry.add(discoveryTools);

  const prefixed = await manager.listPrefixedTools();
  const prefixedMcpTools = prefixed.filter(
    (tool): tool is PrefixedMcpTool => tool instanceof PrefixedMcpTool,
  );

  for (const tool of prefixedMcpTools) {
    registry.hide(
      tool,
      LazyToolRegistry.buildMcpCatalogEntry(
        tool,
        tool.server,
        tool.mcpReadOnlyHint,
      ),
    );
  }

  if (config.tools.subagents.enabled) {
    const subagentRegistry = createSubagentRegistry(config, {
      knownTools: tools.map((entry) => entry.name),
      systemPrompt,
    });
    const subagentTools = createSubagentTools({
      parent: config.name,
      registry: subagentRegistry,
      tools,
      createModel,
    });
    tools.push(...subagentTools);
    registry.add(subagentTools);
  }

  return { tools, registry };
}

function attachToolRegistry(agent: Agent, registry: LazyToolRegistry): void {
  registry.attachAgent(agent as never);
  (agent as unknown as { _toolRegistry: LazyToolRegistry })._toolRegistry =
    registry;
}

export function getAgentConversationManager(
  agent: Agent,
): ConversationManager | undefined {
  return agentConversationManagers.get(agent);
}

export function getAgentSessionManager(
  agent: Agent,
): SessionManager | undefined {
  return agentSessionManagers.get(agent);
}

export async function create(
  config: Config,
  system: SystemPrompt,
  mcp: { manager: McpManager },
  print: boolean = false,
  meta: {
    userId?: string;
    sessionId?: string;
    /** Auto-approve tools (CLI `--yolo`, ACP toggle); stored on {@link Agent.appState}. */
    yolo?: boolean;
    mode?: SessionMode;
    interventions?: InterventionHandler[];
    /** Notified when the session-title plugin generates a title (e.g. ACP `session_info_update`). */
    onSessionTitle?: SessionTitleCallback;
  },
): Promise<Agent> {
  const sessionId = meta.sessionId;
  const userId = meta.userId ?? sessionId;
  // Cache every configured provider so the model can be resolved from the
  // *current* config on demand — keeps model switches (chat `/model`, ACP
  // `session/set_config_option`) applied to subagents, not just the main agent.
  const providerCache = new Map<string, ModelProvider>();
  for (const provider of new Set(
    config.resolvedLlms.map((entry) => entry.provider),
  )) {
    providerCache.set(provider, await modelProviders[provider]!());
  }
  function createLiveModel() {
    const current = config.llm;
    const provider = providerCache.get(current.provider);
    if (!provider) {
      throw new Error(`No model provider loaded for "${current.provider}".`);
    }
    return provider.create(current.providerOptions, current.llmOptions);
  }
  const ctx = createContext(sessionId);
  const {
    plugins: contextPlugins = [],
    conversationManager,
    sessionManager,
    ...agentContext
  } = ctx;
  const skillsPlugin = createAgentSkillsPlugin();
  const sessionModePlugin = createSessionModePromptPlugin();
  // Insert prompt-cache breakpoints for providers that require them (Anthropic,
  // Bedrock). `config.llm` is read per call so runtime model switches apply.
  const promptCachePlugin = createPromptCachePlugin({
    getProvider: () => config.llm.provider,
  });
  // AI session titles from the first user prompt (staged on appState so the
  // session manager's snapshot save persists them).
  const sessionTitlePlugin = createSessionTitlePlugin({
    onTitle: meta.onSessionTitle,
  });
  const gitignoreGuardPlugin = createGitignoreGuardPlugin();

  async function buildBaseSystemPrompt(): Promise<string> {
    await system.reload();
    const appendNext = await mcp.manager.listServerInstructions();
    return [system.content, ...appendNext].filter(Boolean).join(SECTION_BREAK);
  }

  const systemPrompt = await buildBaseSystemPrompt();
  const model = createLiveModel();

  const { tools, registry } = await createToolRegistry({
    config,
    systemPrompt,
    createModel: () => createLiveModel(),
    manager: mcp.manager,
  });

  const agent = new Agent({
    name: config.name,
    systemPrompt,
    model,
    appState: {
      ...(userId ? { userId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(meta.yolo ? { [YOLO_STATE_KEY]: true } : {}),
      ...(meta.mode ? { [MODE_STATE_KEY]: meta.mode } : {}),
    },
    plugins: [
      skillsPlugin,
      sessionModePlugin,
      promptCachePlugin,
      sessionTitlePlugin,
      gitignoreGuardPlugin,
      ...contextPlugins,
    ],
    interventions: meta.interventions ?? [],
    tools,
    retryStrategy: new HoomanDefaultModelRetryStrategy(),
    printer: print,
    ...(conversationManager ? { conversationManager } : {}),
    ...(sessionManager ? { sessionManager } : {}),
    ...agentContext,
  });
  if (conversationManager) {
    agentConversationManagers.set(agent, conversationManager);
  }
  if (sessionManager) {
    agentSessionManagers.set(agent, sessionManager);
  }
  attachToolRegistry(agent, registry);
  await agent.initialize();
  agent.addHook(
    BeforeInvocationEvent,
    async (event) => {
      clearTodoState(event.agent);
      clearReadTimeAgentInstructionState(event.agent);
      clearAgentSkillsPromptInjectionState(event.agent);
      event.agent.systemPrompt = await buildBaseSystemPrompt();
    },
    { order: HookOrder.SDK_FIRST - 1 },
  );
  return agent;
}

export function createContext(sessionId?: string): {
  plugins: Plugin[];
  conversationManager: SummarizingConversationManager;
  memoryManager: ReturnType<typeof createMemoryManager>;
  sessionManager?: SessionManager;
} {
  const conversationManager = new SummarizingConversationManager({
    summaryRatio: 0.5,
    preserveRecentMessages: 5,
  });
  const storage = new FlatFileStorage(sessionsPath());
  const offloadingPlugins = createOffloadingPlugins();
  const memoryManager = createMemoryManager();

  if (!sessionId) {
    return {
      plugins: [...offloadingPlugins, new LazySessionManager({ storage })],
      conversationManager,
      memoryManager,
    };
  }

  const sessionManager = new SessionManager({
    sessionId,
    storage: { snapshot: storage },
  });

  return {
    plugins: offloadingPlugins,
    sessionManager,
    conversationManager,
    memoryManager,
  };
}

function createOffloadingPlugins(): Plugin[] {
  return [
    new ContextOffloader({
      storage: new TolerantFileStorage(offloadedContentPath()),
      maxResultTokens: OFFLOADING_MAX_RESULT_TOKENS,
      previewTokens: OFFLOADING_PREVIEW_TOKENS,
      includeRetrievalTool: true,
    }),
  ];
}

function createMemoryManager() {
  const store = new FileMemoryStore({
    baseDir: memoryPath(),
    name: MEMORY_STORE_NAME,
    description:
      "Durable facts, preferences, recurring tasks, and stable context learned about the current user across sessions.",
    maxSearchResults: MEMORY_MAX_SEARCH_RESULTS,
    writable: true,
    extraction: {
      trigger: new IntervalTrigger({ turns: MEMORY_EXTRACTION_TURNS }),
      extractor: new ToolBasedModelExtractor(),
    },
  });

  return {
    stores: [store],
  };
}
