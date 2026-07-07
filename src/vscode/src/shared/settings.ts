export type ProviderKind =
  | "anthropic"
  | "azure"
  | "bedrock"
  | "google"
  | "groq"
  | "llama-cpp"
  | "minimax"
  | "mlx"
  | "moonshot"
  | "ollama"
  | "openai"
  | "openrouter"
  | "xai";

export type SearchProvider =
  "brave" | "exa" | "firecrawl" | "litellm" | "serper" | "tavily";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type ReasoningDisplay = "summarized" | "omitted";
export type GlobalReasoningDisplay = "collapsed" | "full";
export type OpenAIApi = "chat" | "responses";
export type McpTransportType = "stdio" | "streamable-http" | "sse";
export type McpAuthStatus =
  "unsupported" | "authenticated" | "expired" | "unauthenticated";

export type ToolToggleKey =
  "todo" | "fetch" | "filesystem" | "shell" | "sleep" | "subagents";

export type PromptToggleKey =
  "behaviour" | "communication" | "execution" | "guardrails";

export type TypedFieldKind =
  | "string"
  | "optionalNumber"
  | "optionalInteger"
  | "stringRecord"
  | "optionalBoolean"
  | "openaiApi"
  | "reasoningEffort"
  | "reasoningSummary"
  | "reasoningDisplay"
  | "bedrockCredentials"
  | "promptCache";

export interface TypedFieldDefinition {
  key: string;
  label: string;
  kind: TypedFieldKind;
  placeholder?: string;
  note?: string;
  sensitive?: boolean;
}

export interface ConfigProviderEntryState {
  name: string;
  provider: ProviderKind;
  options: Record<string, unknown>;
  fields: Record<string, string>;
  usageCount: number;
}

export interface ConfigLlmEntryState {
  name: string;
  provider: string;
  options: {
    model: string;
    temperature?: number;
    maxTokens?: number;
    context?: number;
  };
  fields: Record<string, string>;
  default: boolean;
}

export interface ConfigEditorStateInfo {
  path: string;
  name: string;
  dirty: boolean;
  scope: "global" | "project";
  relatedGlobalPath?: string;
  appName: string;
  reasoning: GlobalReasoningDisplay;
  compaction: { ratio: number; keep: number };
  prompts: Record<PromptToggleKey, boolean>;
  tools: Record<ToolToggleKey, boolean>;
  search: {
    enabled: boolean;
    provider: SearchProvider;
    brave: { apiKey?: string };
    exa: { apiKey?: string };
    firecrawl: { apiKey?: string };
    litellm: { apiKey?: string; baseURL?: string; tool?: string };
    serper: { apiKey?: string };
    tavily: { apiKey?: string };
  };
  providers: ConfigProviderEntryState[];
  llms: ConfigLlmEntryState[];
}

export interface McpServerEntryState {
  name: string;
  transportType: McpTransportType;
  summary: string;
  transport: Record<string, unknown>;
  fields: Record<string, string>;
  authStatus: McpAuthStatus;
  shadows?: string;
  shadowedBy?: string;
}

export interface McpEditorStateInfo {
  path: string;
  name: string;
  dirty: boolean;
  scope: "global" | "project";
  relatedGlobalPath?: string;
  relatedProjectPath?: string;
  servers: McpServerEntryState[];
}

export interface InstructionsEditorStateInfo {
  path: string;
  name: string;
  dirty: boolean;
  text: string;
}

export interface SkillInstalledEntryInfo {
  name: string;
  description?: string;
  path: string;
  folder: string;
}

export interface SkillSearchResultInfo {
  name: string;
  slug: string;
  source: string;
  installs: number;
}

export interface SkillsViewStateInfo {
  homePath: string;
  installed: SkillInstalledEntryInfo[];
  query: string;
  results: SkillSearchResultInfo[];
  searched: boolean;
  busy: boolean;
  busyMessage?: string;
}

export type ConfigEditorAction =
  | { type: "refresh" }
  | { type: "openRaw" }
  | { type: "openRelatedGlobal" }
  | {
      type: "saveGeneral";
      appName: string;
      reasoning: GlobalReasoningDisplay;
      compactionRatio: string;
      compactionKeep: string;
    }
  | { type: "setPromptToggle"; key: PromptToggleKey; value: boolean }
  | { type: "setToolToggle"; key: ToolToggleKey; value: boolean }
  | {
      type: "saveSearch";
      enabled: boolean;
      provider: SearchProvider;
      apiKey: string;
      baseURL?: string;
      tool?: string;
    }
  | {
      type: "saveProvider";
      originalName?: string;
      providerType: ProviderKind;
      fields: Record<string, string>;
    }
  | { type: "deleteProvider"; name: string }
  | {
      type: "saveLlm";
      originalName?: string;
      fields: Record<string, string>;
    }
  | { type: "deleteLlm"; name: string }
  | { type: "setDefaultLlm"; name: string };

export type McpEditorAction =
  | { type: "refresh" }
  | { type: "openRaw" }
  | { type: "openRelatedGlobal" }
  | { type: "openRelatedProject" }
  | {
      type: "saveServer";
      originalName?: string;
      transportType: McpTransportType;
      fields: Record<string, string>;
    }
  | { type: "deleteServer"; name: string }
  | { type: "authenticate"; name: string }
  | { type: "logout"; name: string };

export type InstructionsEditorAction =
  | { type: "refresh" }
  | { type: "openRaw" }
  | { type: "saveText"; text: string };

export type SkillsViewAction =
  | { type: "refresh" }
  | { type: "search"; query: string }
  | { type: "installSource"; source: string }
  | { type: "installSearchResult"; slug: string; name: string }
  | { type: "remove"; folder: string; displayName: string }
  | { type: "openSkill"; path: string };

export const SEARCH_PROVIDER_LABELS: Record<SearchProvider, string> = {
  brave: "Brave",
  exa: "Exa",
  firecrawl: "Firecrawl",
  litellm: "LiteLLM",
  serper: "Serper",
  tavily: "Tavily",
};

export const PROMPT_LABELS: Record<PromptToggleKey, string> = {
  behaviour: "Behaviour",
  communication: "Communication",
  execution: "Execution",
  guardrails: "Guardrails",
};

export const SUPPORTED_PROVIDER_TYPES: ProviderKind[] = [
  "anthropic",
  "azure",
  "bedrock",
  "google",
  "groq",
  "llama-cpp",
  "minimax",
  "mlx",
  "moonshot",
  "ollama",
  "openai",
  "openrouter",
  "xai",
];

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  anthropic: "claude-sonnet-4-6",
  azure: "gpt-5.4-mini",
  bedrock: "anthropic.claude-sonnet-4-6",
  google: "gemini-2.5-flash",
  groq: "openai/gpt-oss-20b",
  "llama-cpp": "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",
  minimax: "MiniMax-M3",
  mlx: "mlx-community/gemma-4-e2b-it-OptiQ-4bit",
  moonshot: "kimi-k2-0711-preview",
  ollama: "qwen3:8b",
  openai: "gpt-5-mini",
  openrouter: "openai/gpt-5-mini",
  xai: "grok-3-mini",
};

export const PROVIDER_FIELD_DEFINITIONS: Record<
  ProviderKind,
  TypedFieldDefinition[]
> = {
  anthropic: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "sk-ant-...",
      sensitive: true,
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://api.anthropic.com",
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"x-my-header":"value"}',
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
    {
      key: "reasoningDisplay",
      label: "Reasoning display",
      kind: "reasoningDisplay",
      placeholder: "summarized",
    },
  ],
  azure: [
    {
      key: "resourceName",
      label: "Resource name",
      kind: "string",
      placeholder: "your-resource-name",
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://your-resource-name.openai.azure.com/openai",
    },
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "...",
      sensitive: true,
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"x-my-header":"value"}',
    },
    {
      key: "apiVersion",
      label: "API version",
      kind: "string",
      placeholder: "preview",
    },
    {
      key: "useDeploymentBasedUrls",
      label: "Deployment-based URLs",
      kind: "optionalBoolean",
      placeholder: "false",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
    {
      key: "reasoningSummary",
      label: "Reasoning summary",
      kind: "reasoningSummary",
      placeholder: "auto",
    },
  ],
  bedrock: [
    {
      key: "region",
      label: "Region",
      kind: "string",
      placeholder: "us-west-2",
    },
    {
      key: "credentials",
      label: "Static credentials",
      kind: "bedrockCredentials",
    },
    {
      key: "sessionToken",
      label: "Session token",
      kind: "string",
      placeholder: "...",
      sensitive: true,
    },
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "...",
      sensitive: true,
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
    {
      key: "reasoningDisplay",
      label: "Reasoning display",
      kind: "reasoningDisplay",
      placeholder: "summarized",
    },
  ],
  google: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "...",
      sensitive: true,
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
  ],
  groq: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "gsk_...",
      sensitive: true,
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://api.groq.com/openai/v1",
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"x-my-header":"value"}',
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
  ],
  "llama-cpp": [
    {
      key: "hfToken",
      label: "Hugging Face token",
      kind: "string",
      placeholder: "hf_...",
      sensitive: true,
    },
    {
      key: "context",
      label: "Context size",
      kind: "optionalInteger",
      placeholder: "8192",
    },
    {
      key: "promptCache",
      label: "Prompt cache",
      kind: "optionalBoolean",
      placeholder: "true",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
  ],
  minimax: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "...",
      sensitive: true,
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"x-my-header":"value"}',
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
    {
      key: "reasoningDisplay",
      label: "Reasoning display",
      kind: "reasoningDisplay",
      placeholder: "summarized",
    },
  ],
  mlx: [
    {
      key: "hfToken",
      label: "Hugging Face token",
      kind: "string",
      placeholder: "hf_...",
      sensitive: true,
    },
    {
      key: "context",
      label: "Context size",
      kind: "optionalInteger",
      placeholder: "262144",
    },
    {
      key: "promptCache",
      label: "Prompt cache",
      kind: "promptCache",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
  ],
  moonshot: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "...",
      sensitive: true,
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://api.moonshot.ai/v1",
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"x-my-header":"value"}',
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
  ],
  ollama: [
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "http://127.0.0.1:11434",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
  ],
  openai: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "sk-...",
      sensitive: true,
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://api.openai.com/v1",
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"x-my-header":"value"}',
    },
    {
      key: "api",
      label: "API",
      kind: "openaiApi",
      placeholder: "responses",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
    {
      key: "reasoningSummary",
      label: "Reasoning summary",
      kind: "reasoningSummary",
      placeholder: "auto",
    },
  ],
  openrouter: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "sk-or-...",
      sensitive: true,
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://openrouter.ai/api/v1",
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"HTTP-Referer":"https://example.com","X-Title":"Hooman"}',
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
    },
  ],
  xai: [
    {
      key: "apiKey",
      label: "API key",
      kind: "string",
      placeholder: "...",
      sensitive: true,
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://api.x.ai/v1",
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"x-my-header":"value"}',
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "high",
    },
  ],
};

export const LLM_FIELD_DEFINITIONS: TypedFieldDefinition[] = [
  {
    key: "temperature",
    label: "Temperature",
    kind: "optionalNumber",
    placeholder: "0.7",
  },
  {
    key: "maxTokens",
    label: "Max tokens",
    kind: "optionalInteger",
    placeholder: "4096",
  },
  {
    key: "context",
    label: "Context size",
    kind: "optionalInteger",
    placeholder: "32768",
  },
];

export const MCP_STDIO_FIELDS = [
  { key: "name", label: "Server name", placeholder: "filesystem" },
  { key: "command", label: "Command", placeholder: "npx" },
  {
    key: "args",
    label: "Arguments",
    placeholder: '["-y", "@modelcontextprotocol/server-filesystem"]',
  },
  {
    key: "env",
    label: "Environment variables",
    placeholder: '{"API_KEY":"..."}',
  },
  {
    key: "cwd",
    label: "Working directory",
    placeholder: "/absolute/path",
  },
] as const;

export const MCP_REMOTE_BASE_FIELDS = [
  { key: "name", label: "Server name", placeholder: "my-remote-server" },
  { key: "url", label: "URL", placeholder: "https://example.com/mcp" },
  {
    key: "headers",
    label: "Headers",
    placeholder: '{"Authorization":"Bearer ..."}',
  },
  {
    key: "oauthEnabled",
    label: "Enable OAuth",
    placeholder: "no",
  },
] as const;

export const MCP_REMOTE_OAUTH_FIELDS = [
  { key: "clientId", label: "OAuth client ID", placeholder: "client-id" },
  {
    key: "clientSecret",
    label: "OAuth client secret",
    placeholder: "secret",
  },
  { key: "scopes", label: "OAuth scopes", placeholder: '["read","write"]' },
  {
    key: "audiences",
    label: "OAuth audiences",
    placeholder: '["https://api.example.com"]',
  },
  {
    key: "callbackPort",
    label: "OAuth callback port",
    placeholder: "19876",
  },
  {
    key: "redirectUri",
    label: "OAuth redirect URI",
    placeholder: "http://127.0.0.1:19876/mcp/oauth/callback",
  },
  {
    key: "issuer",
    label: "OAuth issuer",
    placeholder: "https://auth.example.com",
  },
  {
    key: "authorizationUrl",
    label: "OAuth authorization URL override",
    placeholder: "https://auth.example.com/authorize",
  },
  {
    key: "tokenUrl",
    label: "OAuth token URL override",
    placeholder: "https://auth.example.com/token",
  },
  {
    key: "registrationUrl",
    label: "OAuth registration URL override",
    placeholder: "https://auth.example.com/register",
  },
  {
    key: "tokenParamName",
    label: "OAuth token param name",
    placeholder: "access_token",
  },
] as const;

export function defaultModelForProviderType(provider: ProviderKind): string {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function compactModelId(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return model;
  }
  if (trimmed.length <= 36) {
    return trimmed;
  }
  const slash = trimmed.lastIndexOf("/");
  if (slash > 0 && slash < trimmed.length - 1) {
    return trimmed.slice(0, 12) + "…/" + trimmed.slice(slash + 1);
  }
  return trimmed.slice(0, 16) + "…" + trimmed.slice(-12);
}

export function truncate(value: string, max: number): string {
  return value.length <= max
    ? value
    : value.slice(0, Math.max(0, max - 1)) + "…";
}

export function formatTransportSummary(
  transport: Record<string, unknown>,
): string {
  const type = String(transport.type ?? "stdio") as McpTransportType;
  if (type === "stdio") {
    return `stdio • ${truncate(String(transport.command ?? ""), 36)}`;
  }
  const url = truncate(String(transport.url ?? ""), 56);
  const oauth = transport.oauth ? " • oauth" : "";
  return `${type} • ${url}${oauth}`;
}

export function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}
