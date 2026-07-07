// Flat public API for implementation consumers. UI and client-protocol entry
// points stay internal to the CLI package surface.

export { bootstrap } from "./core/index.js";
export type { AcpMeta, BootstrapMeta, BootstrapMode } from "./core/index.js";

export { Config as HoomanConfig, LlmProvider } from "./core/config.js";
export type {
  CompactionConfig,
  ConfigData,
  ConfigOptions,
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
  createRuntimeConfig,
  createRuntimeMcpConfig,
  runtimeConfigOptions,
  runtimeConfigSources,
} from "./core/runtime-config.js";
export type { RuntimeConfigSources } from "./core/runtime-config.js";

export {
  attachmentsPath,
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
  mcpOauthJsonPath,
  memoryPath,
  offloadedContentPath,
  plansPath,
  sessionsPath,
  skillsPath,
} from "./core/utils/paths.js";
export {
  currentProjectRoot,
  projectId,
  projectPath,
  projectRegistryPath,
  projectsPath,
} from "./core/utils/project-registry.js";
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
export {
  candidateWalkUpPaths,
  discoverWalkUpFiles,
  findGitRoot,
} from "./core/utils/discover-files.js";

export { create as createAgent } from "./core/agent/index.js";
export { applySessionMode } from "./core/agent/sync-tool-registry-mode.js";
export { ModeAwareToolRegistry } from "./core/agent/mode-aware-tool-registry.js";

export {
  HOOMAN_CHANNEL,
  HOOMAN_CHANNEL_ASK,
  HOOMAN_CHANNEL_PERMISSION,
  Manager as McpManager,
  createMcpConfig,
  createMcpManager,
  createMcpOAuthService,
  createMcpOAuthStore,
} from "./core/mcp/index.js";
export type {
  ChannelAskOutcome,
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
  createAskUserTools,
  createFetchTools,
  createFilesystemTools,
  createGrepTools,
  createShellTools,
  createSleepTools,
  createThinkingTools,
  createTimeTools,
  createTodoTools,
  createWebSearchTools,
} from "./core/tools/index.js";
export { UPDATE_TODOS_TOOL_NAME } from "./core/tools/todo.js";
export {
  ASK_USER_TOOL_NAME,
  getAskUserBackend,
  setAskUserBackend,
  type AskUserBackend,
  type AskUserRequest,
  type AskUserResponse,
} from "./core/tools/ask-user.js";
export {
  getTerminalBackend,
  setTerminalBackend,
  type TerminalBackend,
  type TerminalRunRequest,
  type TerminalRunResult,
} from "./core/tools/shell.js";
export {
  getTextFsBackend,
  setTextFsBackend,
  type TextFsBackend,
  type TextFsReadOptions,
} from "./core/tools/filesystem.js";

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

export {
  System as SystemPrompt,
  system as createSystemPrompt,
} from "./core/prompts/index.js";
export type { SystemMode } from "./core/prompts/system.js";

export { modelProviders } from "./core/models/index.js";
export type { ModelProvider } from "./core/models/index.js";
export {
  createModelDownloadLogger,
  downloadRatio,
  formatBytes,
  formatBytesPerSecond,
  formatEtaSeconds,
  formatModelDownloadLine,
  renderDownloadBar,
  subscribeModelDownloadProgress,
} from "./core/models/download-progress.js";
export type {
  ModelDownloadProgress,
  ModelDownloadProgressListener,
} from "./core/models/download-progress.js";
export { subscribeModelRetryProgress } from "./core/agent/retry-progress.js";
export type {
  ModelRetryProgress,
  ModelRetryProgressListener,
} from "./core/agent/retry-progress.js";
export {
  create as createAnthropicModelProvider,
  type AnthropicModelParams,
} from "./core/models/anthropic.js";
export {
  create as createAzureModelProvider,
  type AzureModelParams,
} from "./core/models/azure.js";
export { create as createBedrockModelProvider } from "./core/models/bedrock.js";
export type { BedrockLlmParams } from "./core/models/bedrock.js";
export { create as createGoogleModelProvider } from "./core/models/google.js";
export { create as createGroqModelProvider } from "./core/models/groq.js";
export { create as createMinimaxModelProvider } from "./core/models/minimax.js";
export { create as createMoonshotModelProvider } from "./core/models/moonshot.js";
export { create as createOllamaModelProvider } from "./core/models/ollama/index.js";
export {
  create as createOpenAIModelProvider,
  type OpenAIModelParams,
} from "./core/models/openai.js";
export {
  create as createOpenRouterModelProvider,
  type OpenRouterModelParams,
} from "./core/models/openrouter.js";
export { create as createXaiModelProvider } from "./core/models/xai.js";
export {
  StrandsOllamaModel,
  type OllamaModelConfig,
} from "./core/models/ollama/strands-ollama.js";
export { createContext } from "./core/agent/index.js";
export { FlatFileStorage } from "./core/sessions/flat-file-storage.js";
export {
  LazySessionManager,
  type LazySessionManagerConfig,
} from "./core/sessions/lazy-session-manager.js";
export { TolerantFileStorage } from "./core/sessions/tolerant-file-storage.js";
export {
  latestCliSession,
  listCliSessions,
  type CliSessionSummary,
} from "./core/sessions/list-cli-sessions.js";

export {
  SUBAGENT_TOOL_NAME_PREFIX,
  createSubagentTools,
  loadSubagentRegistry,
} from "./core/subagents/index.js";
export type {
  SubagentKindConfig,
  SubagentKindDefinition,
  SubagentRegistry,
} from "./core/subagents/index.js";

export {
  INTERNAL_ALWAYS_ALLOWED as TOOL_APPROVAL_INTERNAL_ALWAYS_ALLOWED,
  isImplicitlyAllowed,
  isToolVisible,
  planModeWriteEditRejectionMessage,
} from "./core/state/tool-approvals.js";
export {
  Allowlist,
  getAllowlist,
  type AllowlistOptions,
  type AllowlistRule,
} from "./core/approvals/allowlist.js";
export {
  arityPrefix,
  splitCommands,
  tokenize,
} from "./core/approvals/bash-arity.js";
export { matchWildcard } from "./core/approvals/wildcard.js";
export {
  HoomanToolApprovalIntervention,
  type HoomanToolApprovalInterventionConfig,
  type ToolApprovalAsk,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolApprovalResult,
} from "./core/approvals/intervention.js";
export {
  createChannelPermissionAsk,
  readChannelOrigin,
  type ChannelOrigin as ToolApprovalChannelOrigin,
} from "./core/approvals/channel-ask.js";
export {
  ChatTurnSteeringController,
  ChatTurnSteeringIntervention,
  createChatTurnSteeringIntervention,
  type QueuedSteeringPrompt,
} from "./core/agent/turn-steering.js";
export {
  YOLO_STATE_KEY,
  isYoloEnabled,
  setYoloEnabled,
} from "./core/state/yolo.js";
export {
  MODE_STATE_KEY,
  getModeState,
  setSessionMode,
  type SessionMode,
} from "./core/state/session-mode.js";
export {
  DEFAULT_SESSION_MODE,
  MODE_DEFINITIONS,
  MODE_IDS,
  formatModeNames,
  getModeDefinition,
  getModeIds,
  getModeOptions,
  getModeTools,
  isKnownSessionMode,
  isModeDefinition,
  loadModeDefinitions,
  type KnownSessionMode,
  type ModeDefinition,
} from "./core/modes/index.js";
export type { LoadedModeDefinition } from "./core/modes/registry.js";
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
