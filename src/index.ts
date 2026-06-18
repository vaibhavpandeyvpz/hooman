// Flat public API for implementation consumers. UI and client-protocol entry
// points stay internal to the CLI package surface.

export { bootstrap } from "./core/index.js";
export type { AcpMeta, BootstrapMeta, BootstrapMode } from "./core/index.js";

export { Config as HoomanConfig, LlmProvider } from "./core/config.js";
export type {
  CompactionConfig,
  ConfigData,
  LlmConfig,
  NamedLlmConfig,
  NamedProviderConfig,
  PromptsConfig,
  ProviderConfig,
  ResolvedNamedLlmConfig,
  SearchConfig,
  ToolsConfig,
} from "./core/config.js";

export {
  attachmentsPath,
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
  mcpOauthJsonPath,
  sessionsPath,
  skillsPath,
} from "./core/utils/paths.js";
export { openBrowser } from "./core/utils/browser.js";
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
export {
  isResolvedPathInsideDir,
  normalizeUserPath,
} from "./core/utils/normalize-user-path.js";

export { create as createAgent } from "./core/agent/index.js";
export { applySessionMode } from "./core/agent/sync-tool-registry-mode.js";

export {
  HOOMAN_CHANNEL,
  HOOMAN_CHANNEL_PERMISSION,
  Manager as McpManager,
  createMcpConfig,
  createMcpManager,
  createMcpOAuthService,
  createMcpOAuthStore,
} from "./core/mcp/index.js";
export type {
  ChannelMessage,
  ChannelPermissionBehavior,
  ChannelSubscription,
  ChannelSubscriptionHandle,
  NamedMcpTransport,
  ServerAuthStatus,
} from "./core/mcp/index.js";
export { Config as McpConfig, type McpServersFile } from "./core/mcp/config.js";
export {
  HoomanMcpOAuthProvider,
  McpOAuthConfigSchema,
  McpOAuthService,
  McpOAuthStore,
  StoredMcpOAuthClientSchema,
  StoredMcpOAuthDiscoverySchema,
  StoredMcpOAuthEntrySchema,
  StoredMcpOAuthFileSchema,
  StoredMcpOAuthTokensSchema,
  canonicalizeRemoteServerUrl,
  createRemoteTransportFingerprint,
  createRemoteTransportIdentity,
  startCallbackServer,
} from "./core/mcp/oauth/index.js";
export type {
  BeginAuthorizationResult as McpBeginAuthorizationResult,
  McpOAuthConfig,
  OAuthRemoteTransport,
  StoredMcpOAuthClient,
  StoredMcpOAuthDiscovery,
  StoredMcpOAuthEntry,
  StoredMcpOAuthFile,
  StoredMcpOAuthTokens,
} from "./core/mcp/oauth/index.js";
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
} from "./core/tools/index.js";
export { UPDATE_TODOS_TOOL_NAME } from "./core/tools/todo.js";

export {
  AGENT_SKILLS_STATE_KEY,
  Registry as SkillsRegistry,
  builtInSkillsPath,
  clearAgentSkillsPromptInjectionState,
  createAgentSkillsPlugin,
  createAgentSkillSources,
  createSkillsRegistry,
} from "./core/skills/index.js";
export type {
  SkillListEntry,
  SkillSearchResult,
} from "./core/skills/registry.js";

export { System as SystemPrompt, system as createSystemPrompt } from "./core/prompts/index.js";
export type { SystemMode } from "./core/prompts/system.js";

export { modelProviders } from "./core/models/index.js";
export type { ModelProvider } from "./core/models/index.js";
export {
  create as createAnthropicModelProvider,
  type AnthropicModelParams,
} from "./core/models/anthropic.js";
export { create as createBedrockModelProvider } from "./core/models/bedrock.js";
export type { BedrockLlmParams } from "./core/models/bedrock.js";
export { create as createGoogleModelProvider } from "./core/models/google.js";
export { create as createGroqModelProvider } from "./core/models/groq.js";
export { create as createMoonshotModelProvider } from "./core/models/moonshot.js";
export { create as createOllamaModelProvider } from "./core/models/ollama/index.js";
export {
  create as createOpenAIModelProvider,
  type OpenAIModelParams,
} from "./core/models/openai.js";
export { create as createXaiModelProvider } from "./core/models/xai.js";
export {
  StrandsOllamaModel,
  type OllamaModelConfig,
} from "./core/models/ollama/strands-ollama.js";
export {
  create as createContext,
  LazySessionManager,
} from "./core/context/index.js";
export type { LazySessionManagerConfig } from "./core/context/index.js";
export { FlatFileStorage } from "./core/context/flat-file-storage.js";

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
  planModeWriteEditRejectionMessage,
} from "./core/state/tool-approvals.js";
export {
  YOLO_STATE_KEY,
  isYoloEnabled,
  setYoloEnabled,
} from "./core/state/yolo.js";
export {
  MODE_STATE_KEY,
  getModeState,
  normalizeSessionMode,
  setSessionMode,
  type SessionMode,
} from "./core/state/session-mode.js";
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
