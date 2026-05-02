// Flat public API for implementation consumers. UI and client-protocol entry
// points stay internal to the CLI package surface.

export { bootstrap } from "./core/index.js";
export type { AcpMeta, BootstrapMeta, BootstrapMode } from "./core/index.js";

export { Config as HoomanConfig, LlmProvider } from "./core/config.js";
export type {
  CompactionConfig,
  ConfigData,
  LlmConfig,
  LtmConfig,
  NamedLlmConfig,
  PromptsConfig,
  SearchConfig,
  ToolsConfig,
  WikiConfig,
} from "./core/config.js";

export {
  attachmentsPath,
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
  sessionsPath,
  skillsPath,
} from "./core/utils/paths.js";
export {
  attachmentDiagnosticBlock,
  attachmentPathsToPromptBlocks,
  normalizeAttachmentPaths,
  readAttachmentAsBlocksOrBase64,
} from "./core/utils/attachments.js";
export type {
  AttachmentBinaryFallback,
  AttachmentMediaBlocks,
  AttachmentReadResult,
} from "./core/utils/attachments.js";
export {
  detectDocumentFormat,
  detectImageFormat,
  detectVideoFormat,
} from "./core/utils/file-formats.js";
export { getCwd, runWithCwd } from "./core/utils/cwd-context.js";

export { create as createAgent } from "./core/agent/index.js";

export {
  HOOMAN_CHANNEL,
  HOOMAN_CHANNEL_PERMISSION,
  Manager as McpManager,
  createMcpConfig,
  createMcpManager,
} from "./core/mcp/index.js";
export type {
  ChannelMessage,
  ChannelPermissionBehavior,
  ChannelSubscription,
  ChannelSubscriptionHandle,
  NamedMcpTransport,
} from "./core/mcp/index.js";
export { Config as McpConfig, type McpServersFile } from "./core/mcp/config.js";
export {
  McpTransportSchema,
  SseSchema,
  StdioSchema,
  StreamableHttpSchema,
} from "./core/mcp/types.js";
export type {
  McpTransport,
  Sse,
  Stdio,
  StreamableHttp,
} from "./core/mcp/types.js";
export { PrefixedMcpTool } from "./core/mcp/prefixed-mcp-tool.js";

export {
  createByeTools,
  createFetchTools,
  createFilesystemTools,
  createShellTools,
  createSleepTools,
  createThinkingTools,
  createTimeTools,
  createTodoTools,
  createWebSearchTools,
  createWikiTools,
} from "./core/tools/index.js";
export { UPDATE_TODOS_TOOL_NAME } from "./core/tools/todo.js";

export {
  Registry as SkillsRegistry,
  createSkillsRegistry,
} from "./core/skills/index.js";
export type {
  SkillListEntry,
  SkillSearchResult,
} from "./core/skills/registry.js";
export { parseSkillFrontmatter } from "./core/skills/metadata.js";
export type { SkillMetadata } from "./core/skills/metadata.js";

export {
  Skills as SkillsPrompt,
  System as SystemPrompt,
  skills as createSkillsPrompt,
  system as createSystemPrompt,
} from "./core/prompts/index.js";
export type { SystemMode } from "./core/prompts/system.js";

export { modelProviders } from "./core/models/index.js";
export type { ModelProvider } from "./core/models/index.js";
export { create as createAnthropicModelProvider } from "./core/models/anthropic.js";
export { create as createBedrockModelProvider } from "./core/models/bedrock.js";
export type { BedrockLlmParams } from "./core/models/bedrock.js";
export { create as createGoogleModelProvider } from "./core/models/google.js";
export { create as createGroqModelProvider } from "./core/models/groq.js";
export { create as createMoonshotModelProvider } from "./core/models/moonshot.js";
export { create as createOllamaModelProvider } from "./core/models/ollama/index.js";
export { create as createOpenAIModelProvider } from "./core/models/openai.js";
export { create as createXaiModelProvider } from "./core/models/xai.js";
export {
  StrandsOllamaModel,
  type OllamaModelConfig,
} from "./core/models/ollama/strands-ollama.js";

export {
  LongTermMemoryStore,
  createLongTermMemoryStore,
  createLongTermMemoryTools,
  createShortTermMemory,
} from "./core/memory/index.js";
export type {
  ArchiveMemoryInput,
  LongTermMemoryOptions,
  LongTermMemoryScope,
  MemorySource,
  SearchMemoryInput,
  SearchMemoryResult,
  StoreMemoryInput,
  StoreMemoryResult,
  UpdateMemoryInput,
} from "./core/memory/index.js";
export { LazySessionManager } from "./core/memory/stm/lazy-session-manager.js";
export type { LazySessionManagerConfig } from "./core/memory/stm/lazy-session-manager.js";
export { FlatFileStorage } from "./core/memory/stm/flat-file-storage.js";
export { HFEmbedding } from "./core/memory/ltm/embed.js";
export type {
  Memory,
  MemoryStatus,
  MemoryType,
} from "./core/memory/ltm/types.js";
export {
  DEFAULT_DEDUPE_THRESHOLD,
  DEFAULT_HALF_LIFE_MS,
  DEFAULT_REINFORCEMENT_STEP,
  buildWhere,
  chromaClientArgsFromUrl,
  clampSearchLimit,
  clampUnitInterval,
  getEffectiveStrength,
  similarity,
  toChromaMetadata,
  toMemory,
} from "./core/memory/ltm/utils.js";
export type { ChromaMemoryMetadata } from "./core/memory/ltm/utils.js";

export {
  BUILTIN_AGENT_CONFIGS,
  BUILTIN_AGENT_KINDS,
  RUN_AGENTS_TOOL_NAME,
  createRunAgentsTools,
  loadBuiltInAgentDefinitions,
  runAgentJobs,
} from "./core/agents/index.js";
export type {
  AgentConfig,
  AgentDefinition,
  AgentJob,
  AgentJobResult,
  AgentKind,
  RunAgentJobsResult,
} from "./core/agents/index.js";

export {
  EXIT_REQUESTED_CODE,
  EXIT_REQUESTED_STATE_KEY,
  consumeExitRequest,
  isExitRequested,
  requestExit,
} from "./core/state/exit-request.js";
export {
  INTERNAL_ALWAYS_ALLOWED as TOOL_APPROVAL_INTERNAL_ALWAYS_ALLOWED,
  allowToolForSession,
  getSessionAllowedTools,
  isToolSessionAllowed,
} from "./core/state/tool-approvals.js";
export {
  TODO_ITEMS_STATE_KEY,
  TODO_VISIBLE_STATE_KEY,
  TodoItemSchema,
  TodoStatusSchema,
  clearTodoState,
  getTodoViewState,
  setTodoState,
  summarizeTodos,
} from "./core/state/todos.js";
export type {
  TodoItem,
  TodoStatus,
  TodoViewState,
} from "./core/state/todos.js";
export {
  readThinkingState,
  writeThinkingState,
} from "./core/state/thought-process.js";
export type {
  ThinkingState,
  ThoughtEntry,
} from "./core/state/thought-process.js";
export {
  setFileToolDisplay,
  takeFileToolDisplay,
} from "./core/state/file-tool-display.js";
export type {
  FileToolDisplay,
  StructuredPatchHunk as FileToolDisplayStructuredPatchHunk,
} from "./core/state/file-tool-display.js";
