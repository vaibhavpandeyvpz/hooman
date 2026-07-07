import React, { useCallback, useEffect, useMemo, useState } from "react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { Box, Text, useApp, useInput } from "ink";
import {
  LlmProvider,
  type ConfigData,
  type NamedLlmConfig,
  type NamedProviderConfig,
} from "../core/config.js";
import { McpOAuthConfigSchema } from "../core/mcp/oauth/types.js";
import {
  McpTransportSchema,
  type Sse,
  type Stdio,
  type StreamableHttp,
} from "../core/mcp/types.js";
import type { McpConfigScope } from "../core/mcp/config.js";
import type {
  SkillListEntry,
  SkillSearchResult,
} from "../core/skills/registry.js";
import { instructionsMdPath } from "../core/utils/paths.js";
import { BusyScreen } from "./components/BusyScreen.js";
import { MenuScreen } from "./components/MenuScreen.js";
import { PromptForm } from "./components/PromptForm.js";
import { openFileInEditor } from "./open-in-editor.js";
import type {
  ConfigureAppProps,
  MenuItem,
  Notice,
  PromptState,
  Screen,
} from "./types.js";
import {
  DEFAULT_INSTRUCTIONS,
  compactJson,
  folderNameForSkill,
  paramsPreview,
  normalizeOptional,
  noticeColor,
  parseOptionalBoolean,
  parseNumber,
  maskSensitiveParamsForDisplay,
  parseStringArray,
  parseStringRecord,
  transportSummary,
  truncate,
} from "./utils.js";

const PROMPT_LABELS: Record<keyof ConfigData["prompts"], string> = {
  behaviour: "Behaviour",
  communication: "Communication",
  execution: "Execution",
  guardrails: "Guardrails",
};

type SearchProvider = ConfigData["search"]["provider"];
type LlmEntry = NamedLlmConfig;
type ProviderEntry = NamedProviderConfig;

const SEARCH_PROVIDER_LABELS: Record<SearchProvider, string> = {
  brave: "Brave",
  exa: "Exa",
  firecrawl: "Firecrawl",
  litellm: "LiteLLM",
  serper: "Serper",
  tavily: "Tavily",
};

type McpDraftField = {
  key: string;
  label: string;
  placeholder?: string;
  note?: string;
};

const MCP_STDIO_FIELDS: McpDraftField[] = [
  { key: "name", label: "Server name", placeholder: "filesystem" },
  { key: "command", label: "Command", placeholder: "npx" },
  {
    key: "args",
    label: "Arguments",
    placeholder: '["-y", "@modelcontextprotocol/server-filesystem"]',
    note: "Provide a JSON array of strings, or leave as [].",
  },
  {
    key: "env",
    label: "Environment variables",
    placeholder: '{"API_KEY":"..."}',
    note: "Optional JSON object with string values.",
  },
  {
    key: "cwd",
    label: "Working directory",
    placeholder: "/absolute/path",
    note: "Optional working directory for the subprocess.",
  },
];

const MCP_REMOTE_BASE_FIELDS: McpDraftField[] = [
  { key: "name", label: "Server name", placeholder: "my-remote-server" },
  { key: "url", label: "URL", placeholder: "https://example.com/mcp" },
  {
    key: "headers",
    label: "Headers",
    placeholder: '{"Authorization":"Bearer ..."}',
    note: "Optional JSON object with string values.",
  },
  {
    key: "oauthEnabled",
    label: "Enable OAuth",
    placeholder: "no",
    note: "Choose yes for servers that use OAuth 2.0/2.1 or dynamic client registration.",
  },
];

const MCP_REMOTE_OAUTH_FIELDS: McpDraftField[] = [
  { key: "clientId", label: "OAuth client ID", placeholder: "client-id" },
  {
    key: "clientSecret",
    label: "OAuth client secret",
    placeholder: "secret",
    note: "Stored in mcp.json only if you enter a value.",
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
];

function isTruthyToggle(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined
    ? ["y", "yes", "true", "1", "on"].includes(normalized)
    : false;
}

function formatDraftFieldValue(
  field: McpDraftField,
  value: string | undefined,
): string {
  const normalized = value ?? "";
  if (!normalized.trim()) {
    return "not set";
  }
  if (
    field.key === "clientSecret" ||
    field.key === "env" ||
    field.key === "headers"
  ) {
    return paramsPreview(normalized);
  }
  return truncate(normalized, 44);
}

type McpAuthStatus =
  "unsupported" | "authenticated" | "expired" | "unauthenticated";

const SUPPORTED_PROVIDER_TYPES = [
  LlmProvider.Anthropic,
  LlmProvider.Azure,
  LlmProvider.Bedrock,
  LlmProvider.Google,
  LlmProvider.Groq,
  LlmProvider.LlamaCpp,
  LlmProvider.Minimax,
  LlmProvider.Mlx,
  LlmProvider.Moonshot,
  LlmProvider.Ollama,
  LlmProvider.OpenAI,
  LlmProvider.OpenRouter,
  LlmProvider.Xai,
] as const;

const DEFAULT_MODEL_BY_PROVIDER: Record<
  (typeof SUPPORTED_PROVIDER_TYPES)[number],
  string
> = {
  [LlmProvider.Anthropic]: "claude-sonnet-4-6",
  [LlmProvider.Azure]: "gpt-5.4-mini",
  [LlmProvider.Bedrock]: "anthropic.claude-sonnet-4-6",
  [LlmProvider.Google]: "gemini-2.5-flash",
  [LlmProvider.Groq]: "openai/gpt-oss-20b",
  [LlmProvider.LlamaCpp]: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",
  [LlmProvider.Minimax]: "MiniMax-M3",
  [LlmProvider.Mlx]: "mlx-community/gemma-4-e2b-it-OptiQ-4bit",
  [LlmProvider.Moonshot]: "kimi-k2.7-code",
  [LlmProvider.Ollama]: "gemma4:e4b",
  [LlmProvider.OpenAI]: "gpt-5.5",
  [LlmProvider.OpenRouter]: "google/gemma-4-26b-a4b-it:free",
  [LlmProvider.Xai]: "grok-4.3",
};

function defaultModelForProviderType(
  provider: (typeof SUPPORTED_PROVIDER_TYPES)[number],
): string {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

function providerOptionsTemplate(
  provider: (typeof SUPPORTED_PROVIDER_TYPES)[number],
): Record<string, unknown> {
  switch (provider) {
    case LlmProvider.Anthropic:
      return {};
    case LlmProvider.Azure:
      return {};
    case LlmProvider.Bedrock:
      return { region: "us-west-2" };
    case LlmProvider.Google:
      return {};
    case LlmProvider.Groq:
      return {};
    case LlmProvider.LlamaCpp:
      return {};
    case LlmProvider.Minimax:
      return {};
    case LlmProvider.Mlx:
      return {};
    case LlmProvider.Moonshot:
      return {};
    case LlmProvider.Ollama:
      return {};
    case LlmProvider.OpenAI:
      return {};
    case LlmProvider.OpenRouter:
      return {};
    case LlmProvider.Xai:
      return {};
  }
}

type TypedFieldKind =
  | "string"
  | "stringRecord"
  | "optionalBoolean"
  | "optionalNumber"
  | "optionalInteger"
  | "bedrockCredentials"
  | "openaiApi"
  | "reasoningEffort"
  | "reasoningSummary"
  | "reasoningDisplay"
  | "promptCache";

type TypedFieldDefinition = {
  key: string;
  label: string;
  kind: TypedFieldKind;
  placeholder?: string;
  note?: string;
  sensitive?: boolean;
};

const PROVIDER_FIELD_DEFINITIONS: Record<
  (typeof SUPPORTED_PROVIDER_TYPES)[number],
  TypedFieldDefinition[]
> = {
  [LlmProvider.Anthropic]: [
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
      note: 'Enables extended thinking (thinking: { type: "enabled", budget_tokens }). Allowed: "minimal", "low", "medium", "high", or blank to disable. Effort maps to a budget (1024/2048/4096/8192); defaults to "medium".',
    },
    {
      key: "reasoningDisplay",
      label: "Reasoning display",
      kind: "reasoningDisplay",
      placeholder: "summarized",
      note: 'For Bedrock Claude via an Anthropic-compatible proxy (Opus 4.7+ hide reasoning by default): "summarized" reveals it (switches to adaptive thinking + output_config.effort); "omitted" to hide; blank keeps the enabled+budget scheme. Do NOT set for the native Anthropic API — it rejects adaptive/display.',
    },
  ],
  [LlmProvider.Azure]: [
    {
      key: "resourceName",
      label: "Resource name",
      kind: "string",
      placeholder: "your-resource-name",
      note: "Used to build the Azure OpenAI base URL when `baseURL` is not set.",
    },
    {
      key: "baseURL",
      label: "Base URL",
      kind: "string",
      placeholder: "https://your-resource-name.openai.azure.com/openai",
      note: "Optional override for the Azure OpenAI endpoint prefix. When set, it takes precedence over `resourceName`.",
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
      note: "Leave blank to use the AI SDK default API version.",
    },
    {
      key: "useDeploymentBasedUrls",
      label: "Deployment-based URLs",
      kind: "optionalBoolean",
      placeholder: "false",
      note: "Toggle between yes and no. Leave unset to use the AI SDK default.",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
      note: 'Responses API. Allowed: "minimal", "low", "medium", "high", or blank. Only reasoning-capable deployments honor it.',
    },
    {
      key: "reasoningSummary",
      label: "Reasoning summary",
      kind: "reasoningSummary",
      placeholder: "auto",
      note: 'Responses API. Allowed: "auto" (default), "concise", "detailed", or "none" to disable.',
    },
  ],
  [LlmProvider.Bedrock]: [
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
      note: "Set both access key ID and secret access key together, or leave blank to rely on the AWS default credential chain.",
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
      note: 'Enables extended thinking on supported models (e.g. Claude). Allowed: "minimal", "low", "medium", "high", or blank. Effort maps to a thinking budget (1024/2048/4096/8192 tokens); defaults to "medium".',
    },
    {
      key: "reasoningDisplay",
      label: "Reasoning display",
      kind: "reasoningDisplay",
      placeholder: "summarized",
      note: 'Newer Bedrock Claude (Opus 4.7+) hide reasoning by default. Set "summarized" to reveal it (switches to adaptive thinking + output_config.effort); "omitted" to hide; blank keeps the enabled+budget scheme.',
    },
  ],
  [LlmProvider.Google]: [
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
      note: 'Enables Gemini thinking with a dynamic budget. Allowed: "minimal", "low", "medium", "high", or blank to leave at the model default.',
    },
  ],
  [LlmProvider.Groq]: [
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
      note: 'Maps to Groq reasoning_effort ("minimal" -> "low"). Allowed: "minimal", "low", "medium", "high", or blank. Only reasoning models honor it.',
    },
  ],
  [LlmProvider.LlamaCpp]: [
    {
      key: "hfToken",
      label: "Hugging Face token",
      kind: "string",
      placeholder: "hf_...",
      sensitive: true,
      note: "Optional; used to download gated/private GGUF repos from the Hugging Face Hub. Falls back to the HF_TOKEN env var.",
    },
    {
      key: "context",
      label: "Context size",
      kind: "optionalInteger",
      placeholder: "8192",
      note: "Context size in tokens (per-LLM `context` overrides this). Leave blank to let node-llama-cpp adapt it to the model and available memory.",
    },
    {
      key: "promptCache",
      label: "Prompt cache",
      kind: "optionalBoolean",
      placeholder: "true",
      note: "Reuse KV state evaluated by previous turns (prompt caching). Defaults to true; set false to re-prefill the full conversation every turn.",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
      note: 'Enables thinking on reasoning-capable GGUFs (Qwen3, Gemma 4, gpt-oss) and caps thought tokens (1024/2048/4096/8192). Allowed: "minimal", "low", "medium", "high", or blank to disable thinking.',
    },
  ],
  [LlmProvider.Minimax]: [
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
      note: 'Enables thinking (normalized to MiniMax adaptive, with budget_tokens). Allowed: "minimal", "low", "medium", "high", or blank to disable. Effort maps to a budget (1024/2048/4096/8192); defaults to "medium".',
    },
    {
      key: "reasoningDisplay",
      label: "Reasoning display",
      kind: "reasoningDisplay",
      placeholder: "summarized",
      note: 'Set "summarized" to switch to adaptive thinking + output_config.effort; "omitted" to hide; blank keeps the adaptive+budget scheme.',
    },
  ],
  [LlmProvider.Mlx]: [
    {
      key: "hfToken",
      label: "Hugging Face token",
      kind: "string",
      placeholder: "hf_...",
      sensitive: true,
      note: "Optional; used to download gated/private MLX repos from the Hugging Face Hub. Falls back to the HF_TOKEN env var.",
    },
    {
      key: "context",
      label: "Context size",
      kind: "optionalInteger",
      placeholder: "262144",
      note: "Declared context window in tokens for the context-usage gauge (per-LLM `context` overrides this). MLX allocates KV state dynamically, so this doesn't size an allocation.",
    },
    {
      key: "promptCache",
      label: "Prompt cache",
      kind: "promptCache",
      note: "Reuse KV state from mlex's internal prompt-cache pool (prefix matching against previous calls), applied when the model loads. Unset, null, or false disables caching entirely; enabling it (with or without overriding mlex's own sizing defaults: 16 entries, 300s TTL, 8-token minimum) turns it on.",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
      note: 'Enables thinking on reasoning-capable MLX models (Qwen3/3.5, Gemma 4, Nemotron) and caps thought tokens (1024/2048/4096/8192). Allowed: "minimal", "low", "medium", "high", or blank to disable thinking.',
    },
  ],
  [LlmProvider.Moonshot]: [
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
      note: "Leave blank to use the default Moonshot API base URL.",
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
      note: 'Enables Kimi thinking (thinking: { type: "enabled" }). Allowed: "minimal", "low", "medium", "high", or blank to disable.',
    },
  ],
  [LlmProvider.Ollama]: [
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
      note: 'Enables Ollama thinking, mapped to the think level ("minimal"/"low" -> "low"). Allowed: "minimal", "low", "medium", "high", or blank to disable.',
    },
  ],
  [LlmProvider.OpenAI]: [
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
      note: 'Allowed: "responses" (default, streams reasoning) or "chat" (for OpenAI-compatible endpoints without the Responses API).',
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
      note: 'Responses API only. Allowed: "minimal", "low", "medium", "high", or blank. Some models (e.g. GPT-5) only emit a reasoning summary at "medium"+.',
    },
    {
      key: "reasoningSummary",
      label: "Reasoning summary",
      kind: "reasoningSummary",
      placeholder: "auto",
      note: 'Responses API only. Allowed: "auto" (default), "concise", "detailed", or "none" to disable.',
    },
  ],
  [LlmProvider.OpenRouter]: [
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
      note: "Leave blank to use the default OpenRouter API base URL.",
    },
    {
      key: "headers",
      label: "Headers",
      kind: "stringRecord",
      placeholder: '{"HTTP-Referer":"https://example.com","X-Title":"Hooman"}',
      note: "Optional extra headers such as attribution metadata for OpenRouter.",
    },
    {
      key: "reasoningEffort",
      label: "Reasoning effort",
      kind: "reasoningEffort",
      placeholder: "medium",
      note: 'Maps to OpenRouter\'s unified reasoning: { effort }. Allowed: "minimal", "low", "medium", "high", or blank. Only reasoning models honor it.',
    },
  ],
  [LlmProvider.Xai]: [
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
      note: 'Maps to xAI reasoning_effort (low/high; "minimal"/"low" -> "low", "medium"/"high" -> "high"). Allowed: "minimal", "low", "medium", "high", or blank. Only reasoning models (e.g. grok-3-mini) honor it.',
    },
  ],
};

const LLM_FIELD_DEFINITIONS: TypedFieldDefinition[] = [
  {
    key: "temperature",
    label: "Temperature",
    kind: "optionalNumber",
    placeholder: "0.7",
    note: "Leave blank to clear.",
  },
  {
    key: "maxTokens",
    label: "Max tokens",
    kind: "optionalInteger",
    placeholder: "4096",
    note: "Leave blank to clear.",
  },
  {
    key: "context",
    label: "Context size",
    kind: "optionalInteger",
    placeholder: "32768",
    note: "Context size in tokens; only honored by the local llama-cpp and mlx providers (overrides their provider-level `context`). Leave blank to clear.",
  },
];

function formatTypedFieldValue(
  definition: TypedFieldDefinition,
  value: unknown,
): string {
  if (value === undefined) {
    return "not set";
  }
  if (definition.sensitive) {
    return "[REDACTED]";
  }
  if (definition.kind === "bedrockCredentials") {
    return value ? "[REDACTED]" : "not set";
  }
  if (definition.kind === "stringRecord") {
    return paramsPreview(value);
  }
  return truncate(String(value), 44);
}

function parseTypedFieldValue(
  input: string,
  definition: TypedFieldDefinition,
): unknown {
  switch (definition.kind) {
    case "string":
      return normalizeOptional(input);
    case "stringRecord":
      return parseStringRecord(input, definition.label);
    case "optionalBoolean":
      return parseOptionalBoolean(input, definition.label);
    case "optionalNumber":
      return normalizeOptional(input) === undefined
        ? undefined
        : parseNumber(input, definition.label);
    case "optionalInteger":
      return normalizeOptional(input) === undefined
        ? undefined
        : parseNumber(input, definition.label, {
            integer: true,
            min: 1,
          });
    case "bedrockCredentials":
      return undefined;
    case "openaiApi": {
      const value = normalizeOptional(input);
      if (value === undefined) {
        return undefined;
      }
      if (value === "chat" || value === "responses") {
        return value;
      }
      throw new Error(`${definition.label} must be "chat" or "responses".`);
    }
    case "reasoningEffort": {
      const value = normalizeOptional(input);
      if (value === undefined) {
        return undefined;
      }
      if (
        value === "minimal" ||
        value === "low" ||
        value === "medium" ||
        value === "high"
      ) {
        return value;
      }
      throw new Error(
        `${definition.label} must be "minimal", "low", "medium", or "high".`,
      );
    }
    case "reasoningSummary": {
      const value = normalizeOptional(input);
      if (value === undefined) {
        return undefined;
      }
      if (
        value === "auto" ||
        value === "concise" ||
        value === "detailed" ||
        value === "none"
      ) {
        return value;
      }
      throw new Error(
        `${definition.label} must be "auto", "concise", "detailed", or "none".`,
      );
    }
    case "reasoningDisplay": {
      const value = normalizeOptional(input);
      if (value === undefined) {
        return undefined;
      }
      if (value === "summarized" || value === "omitted") {
        return value;
      }
      throw new Error(`${definition.label} must be "summarized" or "omitted".`);
    }
    case "promptCache":
      // Edited via a dedicated screen (config-provider-prompt-cache), never
      // through the generic promptValue path.
      return undefined;
  }
}

/** Label suffix for the mlx `promptCache` provider field row. */
function formatPromptCacheSummary(value: unknown): string {
  if (value === undefined || value === null || value === false) {
    return "disabled";
  }
  const config = value as {
    minTokens?: number;
    maxEntries?: number;
    ttl?: number;
  };
  const overrides: string[] = [];
  if (config.maxEntries !== undefined) {
    overrides.push(`maxEntries=${config.maxEntries}`);
  }
  if (config.ttl !== undefined) {
    overrides.push(`ttl=${config.ttl}s`);
  }
  if (config.minTokens !== undefined) {
    overrides.push(`minTokens=${config.minTokens}`);
  }
  return overrides.length > 0 ? `enabled (${overrides.join(", ")})` : "enabled";
}

/** On/off display for tool rows (`Tool • Yes` / `Tool • No`). */
const yesNo = (on: boolean): string => (on ? "Yes" : "No");

function formatMcpScope(scope: McpConfigScope): string {
  return scope === "global" ? "global" : "project";
}

function formatMcpWriteTargetLabel(path: string): string {
  return truncate(path, 72);
}

function formatMcpDeleteDescription(
  name: string,
  sourcePath: string,
  scope: McpConfigScope,
): string {
  return `Remove "${name}" from ${formatMcpScope(scope)} mcp.json (${truncate(sourcePath, 64)})? This cannot be undone from here.`;
}

function formatConfigureError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) {
      return "Invalid value.";
    }
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function ConfigureApp({
  config,
  mcpConfig,
  mcpManager,
  skills,
  onExit,
}: ConfigureAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [mcpDraft, setMcpDraft] = useState<Record<string, string> | null>(null);
  const [providerDraft, setProviderDraft] = useState<Record<
    string,
    string
  > | null>(null);
  const [providerDraftType, setProviderDraftType] = useState<
    (typeof SUPPORTED_PROVIDER_TYPES)[number] | null
  >(null);
  const [llmDraft, setLlmDraft] = useState<Record<string, string> | null>(null);
  const [installedSkills, setInstalledSkills] = useState<SkillListEntry[]>([]);
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([]);
  const [mcpAuthStatuses, setMcpAuthStatuses] = useState<
    Record<string, McpAuthStatus>
  >({});

  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const handleActionError = useCallback((error: unknown) => {
    setNotice({
      kind: "error",
      text: formatConfigureError(error),
    });
  }, []);

  const runTask = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusyMessage(label);
      try {
        await task();
      } catch (error) {
        handleActionError(error);
      } finally {
        setBusyMessage(null);
      }
    },
    [handleActionError],
  );

  const refreshSkills = useCallback(
    async (label: string = "Loading installed skills...") => {
      await runTask(label, async () => {
        const next = await skills.list();
        setInstalledSkills(next);
      });
    },
    [runTask, skills],
  );

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  useEffect(() => {
    let cancelled = false;
    const loadStatuses = async () => {
      try {
        const rows = await mcpManager.listAuthStatuses();
        if (cancelled) {
          return;
        }
        setMcpAuthStatuses(
          Object.fromEntries(rows.map((row) => [row.name, row.status])),
        );
      } catch {
        if (!cancelled) {
          setMcpAuthStatuses({});
        }
      }
    };
    void loadStatuses();
    return () => {
      cancelled = true;
    };
  }, [mcpManager, revision]);

  const configData = useMemo(
    () =>
      ({
        name: config.name,
        providers: config.providers,
        llms: config.llms,
        search: config.search,
        prompts: config.prompts,
        tools: config.tools,
        compaction: config.compaction,
        reasoning: config.reasoning,
      }) satisfies ConfigData,
    [config, revision],
  );

  const mcpServers = useMemo(
    () => mcpConfig.listWithSources(),
    [mcpConfig, revision],
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input.toLowerCase() === "c") {
        onExit();
        exit();
        return;
      }
      if (!key.escape || busyMessage) {
        return;
      }
      if (prompt) {
        prompt.onCancel?.();
        setPrompt(null);
        return;
      }
      if (
        screen.kind === "mcp-stdio-edit" ||
        screen.kind === "mcp-remote-edit"
      ) {
        setMcpDraft(null);
        setScreen({ kind: "mcp" });
        return;
      }
      if (screen.kind === "config-provider-create") {
        setProviderDraft(null);
        setProviderDraftType(null);
        setScreen({ kind: "config-providers" });
        return;
      }
      if (screen.kind === "config-provider-create-type") {
        setScreen({ kind: "config-provider-create" });
        return;
      }
      if (screen.kind === "config-llm-create") {
        setLlmDraft(null);
        setScreen({ kind: "config-llms" });
        return;
      }
      if (screen.kind === "config-llm-create-provider") {
        setScreen({ kind: "config-llm-create" });
        return;
      }
      if (
        screen.kind === "mcp-delete-confirm" ||
        screen.kind === "mcp-save-target"
      ) {
        setScreen({ kind: "mcp" });
        return;
      }
      if (screen.kind === "skills-delete-confirm") {
        setScreen({ kind: "skills" });
        return;
      }
      if (screen.kind === "config-llm-delete-confirm") {
        setScreen({ kind: "config-llm-edit", name: screen.name });
        return;
      }
      if (screen.kind === "config-provider-delete-confirm") {
        setScreen({ kind: "config-provider-edit", name: screen.name });
        return;
      }
      if (
        screen.kind === "config-provider-openai-api" ||
        screen.kind === "config-provider-reasoning-effort" ||
        screen.kind === "config-provider-reasoning-summary" ||
        screen.kind === "config-provider-reasoning-display" ||
        screen.kind === "config-provider-prompt-cache"
      ) {
        setScreen({ kind: "config-provider-edit", name: screen.name });
        return;
      }
      if (screen.kind === "config-provider-add-type") {
        setScreen({ kind: "config-providers" });
        return;
      }
      if (screen.kind === "config-providers" || screen.kind === "config-llms") {
        setScreen({ kind: "config" });
        return;
      }
      if (screen.kind !== "home") {
        setScreen({ kind: "home" });
        return;
      }
      onExit();
      exit();
    },
    { isActive: true },
  );

  const setSuccess = useCallback((text: string) => {
    setNotice({ kind: "success", text });
  }, []);

  const setError = useCallback((text: string) => {
    setNotice({ kind: "error", text });
  }, []);

  const authenticateMcpServer = useCallback(
    async (name: string) => {
      await runTask(`Authenticating MCP server "${name}"...`, async () => {
        await mcpManager.authenticate(name);
        refresh();
        setSuccess(`Authenticated MCP server "${name}".`);
      });
    },
    [mcpManager, refresh, runTask, setSuccess],
  );

  const logoutMcpServer = useCallback(
    async (name: string) => {
      await runTask(`Logging out MCP server "${name}"...`, async () => {
        await mcpManager.logout(name);
        refresh();
        setSuccess(`Cleared OAuth credentials for "${name}".`);
      });
    },
    [mcpManager, refresh, runTask, setSuccess],
  );

  const updateConfig = useCallback(
    (partial: Partial<ConfigData>, message: string) => {
      const result = config.tryUpdate(partial);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      refresh();
      setSuccess(message);
      return true;
    },
    [config, refresh, setError, setSuccess],
  );

  const patchLlm = useCallback(
    (name: string, patch: Record<string, unknown>) =>
      config.llms.map((m) =>
        m.name === name
          ? {
              ...m,
              options: {
                ...(m.options as Record<string, unknown>),
                ...patch,
              } as LlmEntry["options"],
            }
          : m,
      ) as ConfigData["llms"],
    [config],
  );

  const renameLlm = useCallback(
    (oldName: string, newName: string) =>
      config.llms.map((m) =>
        m.name === oldName ? { ...m, name: newName } : m,
      ),
    [config],
  );

  const setDefaultLlm = useCallback(
    (name: string) =>
      config.llms.map((m) => ({ ...m, default: m.name === name })),
    [config],
  );

  const addLlmEntry = useCallback(
    (entry: LlmEntry) => [...config.llms, entry] as ConfigData["llms"],
    [config],
  );

  const addProviderEntry = useCallback(
    (entry: ProviderEntry) =>
      [...config.providers, entry] as ConfigData["providers"],
    [config],
  );

  const removeLlm = useCallback(
    (name: string) => config.llms.filter((m) => m.name !== name),
    [config],
  );

  const patchProvider = useCallback(
    (name: string, patch: Record<string, unknown>) =>
      config.providers.map((provider) =>
        provider.name === name
          ? {
              ...provider,
              options: {
                ...(provider.options as Record<string, unknown>),
                ...patch,
              } as ProviderEntry["options"],
            }
          : provider,
      ) as ConfigData["providers"],
    [config],
  );

  const renameProvider = useCallback(
    (oldName: string, newName: string) => ({
      providers: config.providers.map((provider) =>
        provider.name === oldName ? { ...provider, name: newName } : provider,
      ),
      llms: config.llms.map((llm) =>
        llm.provider === oldName
          ? {
              ...llm,
              provider: newName,
            }
          : llm,
      ),
    }),
    [config],
  );

  const addProvider = useCallback(
    (name: string, provider: (typeof SUPPORTED_PROVIDER_TYPES)[number]) => [
      ...config.providers,
      {
        name,
        provider,
        options: {
          ...providerOptionsTemplate(provider),
        },
      },
    ],
    [config],
  );

  const removeProvider = useCallback(
    (name: string) =>
      config.providers.filter((provider) => provider.name !== name),
    [config],
  );

  const updateProviderDraftField = useCallback((key: string, value: string) => {
    setProviderDraft((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }, []);

  const updateLlmDraftField = useCallback((key: string, value: string) => {
    setLlmDraft((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }, []);

  const promptValue = useCallback((state: PromptState) => {
    setPrompt(state);
  }, []);

  const handlePromptSubmit = useCallback(
    async (value: string) => {
      if (!prompt) {
        return;
      }
      try {
        await prompt.onSubmit(value);
      } catch (error) {
        handleActionError(error);
      }
    },
    [handleActionError, prompt],
  );

  const persistMcpTransport = useCallback(
    (
      currentName: string | undefined,
      nextName: string,
      transport: Stdio | StreamableHttp | Sse,
      targetPath?: string,
    ) => {
      if (!nextName) {
        throw new Error("Server name is required.");
      }
      if (!currentName) {
        if (!targetPath) {
          throw new Error("Save target is required for a new MCP server.");
        }
        mcpConfig.addToPath(targetPath, nextName, transport);
        setSuccess(`Added MCP server "${nextName}".`);
      } else {
        const currentEntry = mcpConfig.getEntry(currentName);
        if (!currentEntry) {
          throw new Error(`MCP server "${currentName}" does not exist.`);
        }
        if (currentName === nextName) {
          mcpConfig.updateInPath(
            currentEntry.sourcePath,
            currentName,
            transport,
          );
          setSuccess(`Updated MCP server "${currentName}".`);
        } else {
          mcpConfig.renameInPath(
            currentEntry.sourcePath,
            currentName,
            nextName,
            transport,
          );
          setSuccess(`Renamed MCP server "${currentName}" to "${nextName}".`);
        }
      }
      setMcpDraft(null);
      setScreen({ kind: "mcp" });
      refresh();
    },
    [mcpConfig, refresh, setSuccess],
  );

  const openMcpStdioEditor = useCallback(
    (currentName?: string, initial?: Stdio) => {
      setMcpDraft({
        name: currentName ?? "",
        command: initial?.command ?? "",
        args: compactJson(initial?.args ?? []),
        env: initial?.env ? compactJson(initial.env) : "",
        cwd: initial?.cwd ?? "",
      });
      setScreen({ kind: "mcp-stdio-edit", originalName: currentName });
    },
    [],
  );

  const openMcpRemoteEditor = useCallback(
    (
      type: StreamableHttp["type"] | Sse["type"],
      currentName?: string,
      initial?: StreamableHttp | Sse,
    ) => {
      setMcpDraft({
        name: currentName ?? "",
        url: initial?.url ?? "",
        headers: initial?.headers ? compactJson(initial.headers) : "",
        oauthEnabled: initial?.oauth ? "yes" : "no",
        clientId: initial?.oauth?.clientId ?? "",
        clientSecret: initial?.oauth?.clientSecret ?? "",
        scopes: initial?.oauth?.scopes ? compactJson(initial.oauth.scopes) : "",
        audiences: initial?.oauth?.audiences
          ? compactJson(initial.oauth.audiences)
          : "",
        callbackPort:
          initial?.oauth?.callbackPort !== undefined
            ? String(initial.oauth.callbackPort)
            : "",
        redirectUri: initial?.oauth?.redirectUri ?? "",
        issuer: initial?.oauth?.issuer ?? "",
        authorizationUrl: initial?.oauth?.authorizationUrl ?? "",
        tokenUrl: initial?.oauth?.tokenUrl ?? "",
        registrationUrl: initial?.oauth?.registrationUrl ?? "",
        tokenParamName: initial?.oauth?.tokenParamName ?? "",
      });
      setScreen({
        kind: "mcp-remote-edit",
        transportType: type,
        originalName: currentName,
      });
    },
    [],
  );

  const updateMcpDraftField = useCallback((key: string, value: string) => {
    setMcpDraft((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }, []);

  const editMcpDraftField = useCallback(
    (field: McpDraftField, initialValue: string) => {
      promptValue({
        title: `Update ${field.label}`,
        label: field.label,
        initialValue,
        placeholder: field.placeholder,
        note: field.note,
        onSubmit: async (value) => {
          updateMcpDraftField(field.key, value);
          setPrompt(null);
        },
      });
    },
    [promptValue, updateMcpDraftField],
  );

  const editProviderDraftField = useCallback(
    (definition: TypedFieldDefinition, initialValue: string) => {
      promptValue({
        title: `Update ${definition.label}`,
        label: definition.label,
        initialValue,
        placeholder: definition.placeholder,
        note: definition.note,
        onSubmit: async (value) => {
          updateProviderDraftField(definition.key, value);
          setPrompt(null);
        },
      });
    },
    [promptValue, updateProviderDraftField],
  );

  const editLlmDraftField = useCallback(
    (label: string, key: string, initialValue: string, note?: string) => {
      promptValue({
        title: `Update ${label}`,
        label,
        initialValue,
        note,
        onSubmit: async (value) => {
          updateLlmDraftField(key, value);
          setPrompt(null);
        },
      });
    },
    [promptValue, updateLlmDraftField],
  );

  const buildMcpStdioDraft = useCallback(() => {
    const values = mcpDraft ?? {};
    const name = (values.name ?? "").trim();
    const command = (values.command ?? "").trim();
    if (!name) {
      throw new Error("Server name is required.");
    }
    if (!command) {
      throw new Error("Command is required.");
    }
    const args = parseStringArray(values.args ?? "", "Arguments");
    const env = parseStringRecord(values.env ?? "", "Environment variables");
    const cwd = normalizeOptional(values.cwd ?? "");
    const transport = McpTransportSchema.parse({
      type: "stdio",
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
      ...(cwd ? { cwd } : {}),
    }) as Stdio;
    return { name, transport };
  }, [mcpDraft]);

  const buildMcpRemoteDraft = useCallback(
    (transportType: StreamableHttp["type"] | Sse["type"]) => {
      const values = mcpDraft ?? {};
      const name = (values.name ?? "").trim();
      const url = (values.url ?? "").trim();
      if (!name) {
        throw new Error("Server name is required.");
      }
      if (!url) {
        throw new Error("URL is required.");
      }
      const headers = parseStringRecord(values.headers ?? "", "Headers");
      const oauthEnabled = parseOptionalBoolean(
        values.oauthEnabled ?? "",
        "Enable OAuth",
      );
      const scopes = parseStringArray(values.scopes ?? "", "OAuth scopes");
      const audiences = parseStringArray(
        values.audiences ?? "",
        "OAuth audiences",
      );
      const callbackPort =
        normalizeOptional(values.callbackPort ?? "") !== undefined
          ? parseNumber(values.callbackPort ?? "", "OAuth callback port", {
              integer: true,
              min: 1,
              max: 65535,
            })
          : undefined;
      const oauth = oauthEnabled
        ? McpOAuthConfigSchema.parse({
            enabled: true,
            ...(normalizeOptional(values.clientId ?? "")
              ? { clientId: normalizeOptional(values.clientId ?? "") }
              : {}),
            ...(normalizeOptional(values.clientSecret ?? "")
              ? { clientSecret: normalizeOptional(values.clientSecret ?? "") }
              : {}),
            ...(scopes.length > 0 ? { scopes } : {}),
            ...(audiences.length > 0 ? { audiences } : {}),
            ...(callbackPort !== undefined ? { callbackPort } : {}),
            ...(normalizeOptional(values.redirectUri ?? "")
              ? { redirectUri: normalizeOptional(values.redirectUri ?? "") }
              : {}),
            ...(normalizeOptional(values.issuer ?? "")
              ? { issuer: normalizeOptional(values.issuer ?? "") }
              : {}),
            ...(normalizeOptional(values.authorizationUrl ?? "")
              ? {
                  authorizationUrl: normalizeOptional(
                    values.authorizationUrl ?? "",
                  ),
                }
              : {}),
            ...(normalizeOptional(values.tokenUrl ?? "")
              ? { tokenUrl: normalizeOptional(values.tokenUrl ?? "") }
              : {}),
            ...(normalizeOptional(values.registrationUrl ?? "")
              ? {
                  registrationUrl: normalizeOptional(
                    values.registrationUrl ?? "",
                  ),
                }
              : {}),
            ...(normalizeOptional(values.tokenParamName ?? "")
              ? {
                  tokenParamName: normalizeOptional(
                    values.tokenParamName ?? "",
                  ),
                }
              : {}),
          })
        : undefined;
      const transport = McpTransportSchema.parse({
        type: transportType,
        url,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
        ...(oauth ? { oauth } : {}),
      }) as StreamableHttp | Sse;
      return { name, transport };
    },
    [mcpDraft],
  );

  const saveMcpStdioDraft = useCallback(
    (originalName?: string) => {
      const { name, transport } = buildMcpStdioDraft();
      if (!originalName) {
        setScreen({ kind: "mcp-save-target", transportType: "stdio" });
        return;
      }
      persistMcpTransport(originalName, name, transport);
    },
    [buildMcpStdioDraft, persistMcpTransport],
  );

  const saveMcpRemoteDraft = useCallback(
    (
      transportType: StreamableHttp["type"] | Sse["type"],
      originalName?: string,
    ) => {
      const { name, transport } = buildMcpRemoteDraft(transportType);
      if (!originalName) {
        setScreen({ kind: "mcp-save-target", transportType });
        return;
      }
      persistMcpTransport(originalName, name, transport);
    },
    [buildMcpRemoteDraft, persistMcpTransport],
  );

  const llmSummary = useCallback(
    (entry: LlmEntry): string => {
      const compactModelId = (model: string): string => {
        if (model.length <= 23) {
          return model;
        }
        return `${model.slice(0, 10)}...${model.slice(-10)}`;
      };
      const resolved = config.resolveLlm(entry.name);
      if (!resolved) {
        return `${entry.provider}/${compactModelId(entry.options.model)}`;
      }
      return `${entry.provider} -> ${resolved.provider}/${compactModelId(resolved.llmOptions.model)}`;
    },
    [config],
  );

  const providerUsageCount = useCallback(
    (name: string): number =>
      config.llms.filter((llm) => llm.provider === name).length,
    [config],
  );

  const renderHome = () => {
    const defaultLlm = config.llms.find((m) => m.default) ?? config.llms[0];
    const items: MenuItem[] = [
      {
        label: "General",
        value: () => setScreen({ kind: "config-general" }),
      },
      {
        label: "Instructions • edit instructions.md",
        value: () => {
          try {
            const path = instructionsMdPath();
            const current = existsSync(path)
              ? readFileSync(path, "utf8")
              : DEFAULT_INSTRUCTIONS;
            const next = openFileInEditor(path, current).trim();
            if (!next) {
              throw new Error("instructions.md cannot be empty.");
            }
            writeFileSync(path, `${next}\n`, "utf8");
            setSuccess("Updated instructions.md.");
          } catch (error) {
            handleActionError(error);
          }
        },
      },
      {
        label: defaultLlm ? `Models • ${defaultLlm.name}` : "Models",
        value: () => setScreen({ kind: "config" }),
      },
      {
        label: `MCP servers • ${mcpServers.length} configured`,
        value: () => setScreen({ kind: "mcp" }),
      },
      {
        label: `Skills • ${installedSkills.length} installed`,
        value: () => setScreen({ kind: "skills" }),
      },
      {
        label: "Back",
        value: () => {
          onExit();
          exit();
        },
      },
    ];
    return (
      <MenuScreen
        title={configData.name}
        description={`models: ${llmSummary(
          config.llms.find((m) => m.default) ?? config.llms[0]!,
        )}`}
        items={items}
        footerHint="enter: select | esc: back"
        onActionError={handleActionError}
      />
    );
  };

  const renderGeneralMenu = () => {
    const enabledPrompts = Object.values(configData.prompts).filter(
      Boolean,
    ).length;
    const totalPrompts = Object.keys(configData.prompts).length;
    const items: MenuItem[] = [
      {
        label: `Name • ${configData.name}`,
        value: () =>
          promptValue({
            title: "Update app name",
            label: "Name",
            initialValue: configData.name,
            onSubmit: async (value) => {
              const next = value.trim();
              if (!next) {
                throw new Error("Name is required.");
              }
              if (updateConfig({ name: next }, "Updated app name.")) {
                setPrompt(null);
              }
            },
          }),
      },
      {
        label: `Prompts • ${enabledPrompts}/${totalPrompts} enabled`,
        value: () => setScreen({ kind: "config-prompts" }),
      },
      {
        label: "Tools • configure enabled tools",
        value: () => setScreen({ kind: "config-tools" }),
      },
      {
        label: `Compaction ratio • ${configData.compaction.ratio}`,
        value: () =>
          promptValue({
            title: "Update compaction ratio",
            label: "Ratio",
            initialValue: String(configData.compaction.ratio),
            onSubmit: async (value) => {
              const ratio = parseNumber(value, "Compaction ratio", {
                min: 0,
                max: 1,
              });
              if (
                updateConfig(
                  {
                    compaction: {
                      ...config.compaction,
                      ratio,
                    },
                  },
                  "Updated compaction ratio.",
                )
              ) {
                setPrompt(null);
              }
            },
          }),
      },
      {
        label: `Compaction keep • ${configData.compaction.keep}`,
        value: () =>
          promptValue({
            title: "Update compaction keep",
            label: "Keep",
            initialValue: String(configData.compaction.keep),
            onSubmit: async (value) => {
              const keep = parseNumber(value, "Compaction keep", {
                min: 0,
                integer: true,
              });
              if (
                updateConfig(
                  {
                    compaction: {
                      ...config.compaction,
                      keep,
                    },
                  },
                  "Updated compaction keep.",
                )
              ) {
                setPrompt(null);
              }
            },
          }),
      },
      {
        key: "reasoning-display",
        label: `Reasoning display • ${configData.reasoning}`,
        value: () => {
          const next =
            configData.reasoning === "collapsed" ? "full" : "collapsed";
          updateConfig(
            { reasoning: next },
            `Set reasoning display to "${next}".`,
          );
        },
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];

    return (
      <MenuScreen
        title="General"
        description="Manage app-wide settings loaded from ~/.hooman/config.json."
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderConfigMenu = () => {
    const defaultLlm = config.llms.find((m) => m.default) ?? config.llms[0]!;
    const items: MenuItem[] = [
      {
        label: `LLMs • ${config.llms.length} configured (default: ${defaultLlm.name})`,
        value: () => setScreen({ kind: "config-llms" }),
      },
      {
        label: `Providers • ${config.providers.length} configured`,
        value: () => setScreen({ kind: "config-providers" }),
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];

    return (
      <MenuScreen
        title="Models"
        description="Manage configured providers and LLMs from ~/.hooman/config.json."
        items={items}
      />
    );
  };

  const renderToolsConfigMenu = () => {
    const items: MenuItem[] = [
      {
        label: `Search tool • ${yesNo(configData.search.enabled)} • ${SEARCH_PROVIDER_LABELS[configData.search.provider]}`,
        value: () => setScreen({ kind: "config-search" }),
      },
      {
        label: `Todo tool • ${yesNo(configData.tools.todo.enabled)}`,
        value: () => {
          if (
            updateConfig(
              {
                tools: {
                  ...config.tools,
                  todo: {
                    enabled: !configData.tools.todo.enabled,
                  },
                },
              },
              `Todo tool ${configData.tools.todo.enabled ? "disabled" : "enabled"}.`,
            )
          ) {
            setScreen({ kind: "config-tools" });
          }
        },
      },
      {
        label: `Fetch tool • ${yesNo(configData.tools.fetch.enabled)}`,
        value: () => {
          if (
            updateConfig(
              {
                tools: {
                  ...config.tools,
                  fetch: {
                    enabled: !configData.tools.fetch.enabled,
                  },
                },
              },
              `Fetch tool ${configData.tools.fetch.enabled ? "disabled" : "enabled"}.`,
            )
          ) {
            setScreen({ kind: "config-tools" });
          }
        },
      },
      {
        label: `Filesystem tool • ${yesNo(configData.tools.filesystem.enabled)}`,
        value: () => {
          if (
            updateConfig(
              {
                tools: {
                  ...config.tools,
                  filesystem: {
                    enabled: !configData.tools.filesystem.enabled,
                  },
                },
              },
              `Filesystem tool ${configData.tools.filesystem.enabled ? "disabled" : "enabled"}.`,
            )
          ) {
            setScreen({ kind: "config-tools" });
          }
        },
      },
      {
        label: `Shell tool • ${yesNo(configData.tools.shell.enabled)}`,
        value: () => {
          if (
            updateConfig(
              {
                tools: {
                  ...config.tools,
                  shell: {
                    enabled: !configData.tools.shell.enabled,
                  },
                },
              },
              `Shell tool ${configData.tools.shell.enabled ? "disabled" : "enabled"}.`,
            )
          ) {
            setScreen({ kind: "config-tools" });
          }
        },
      },
      {
        label: `Sleep tool • ${yesNo(configData.tools.sleep.enabled)}`,
        value: () => {
          if (
            updateConfig(
              {
                tools: {
                  ...config.tools,
                  sleep: {
                    enabled: !configData.tools.sleep.enabled,
                  },
                },
              },
              `Sleep tool ${configData.tools.sleep.enabled ? "disabled" : "enabled"}.`,
            )
          ) {
            setScreen({ kind: "config-tools" });
          }
        },
      },
      {
        label: `Subagents • ${yesNo(configData.tools.subagents.enabled)}`,
        value: () => {
          if (
            updateConfig(
              {
                tools: {
                  ...config.tools,
                  subagents: {
                    ...config.tools.subagents,
                    enabled: !configData.tools.subagents.enabled,
                  },
                },
              },
              `Subagents ${configData.tools.subagents.enabled ? "disabled" : "enabled"}.`,
            )
          ) {
            setScreen({ kind: "config-tools" });
          }
        },
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "config-general" }),
      },
    ];

    return (
      <MenuScreen
        title="Tools"
        description="Enable, disable, and configure built-in tools."
        items={items}
      />
    );
  };

  const renderProvidersMenu = () => {
    const providerItems: MenuItem[] = config.providers.map((provider) => ({
      key: `provider:${provider.name}`,
      label: `${provider.name} • ${provider.provider} • ${providerUsageCount(provider.name)} model(s)`,
      boldSubstring: provider.name,
      value: () =>
        setScreen({ kind: "config-provider-edit", name: provider.name }),
    }));

    const items: MenuItem[] = [
      {
        label: "Add provider",
        value: () => {
          setProviderDraft({ name: "" });
          setProviderDraftType(SUPPORTED_PROVIDER_TYPES[0]);
          setScreen({ kind: "config-provider-create" });
        },
      },
      ...providerItems,
      {
        label: "Back",
        value: () => setScreen({ kind: "config" }),
      },
    ];

    return (
      <MenuScreen
        title="Providers"
        description="Configure reusable provider credentials and shared params."
        items={items}
      />
    );
  };

  const renderProviderCreateMenu = () => {
    if (screen.kind !== "config-provider-create" || !providerDraft) {
      return null;
    }
    const providerType = providerDraftType ?? SUPPORTED_PROVIDER_TYPES[0];
    const providerFields = PROVIDER_FIELD_DEFINITIONS[providerType];
    const items: MenuItem[] = [
      {
        label: `Name • ${providerDraft.name?.trim() ? providerDraft.name : "not set"}`,
        value: () =>
          editProviderDraftField(
            {
              key: "name",
              label: "Name",
              kind: "string",
              placeholder: "openai-prod",
            },
            providerDraft.name ?? "",
          ),
      },
      {
        label: `Type • ${providerType}`,
        value: () => setScreen({ kind: "config-provider-create-type" }),
      },
      ...providerFields.map((definition) => ({
        key: `provider-create-field:${definition.key}`,
        label: `${definition.label} • ${formatDraftFieldValue(
          {
            key: definition.key,
            label: definition.label,
            placeholder: definition.placeholder,
            note: definition.note,
          },
          providerDraft[definition.key],
        )}`,
        value: () => {
          if (definition.kind === "optionalBoolean") {
            updateProviderDraftField(
              definition.key,
              isTruthyToggle(providerDraft[definition.key]) ? "no" : "yes",
            );
            return;
          }
          editProviderDraftField(
            definition,
            providerDraft[definition.key] ?? "",
          );
        },
      })),
      {
        label: "Save",
        value: () => {
          const name = (providerDraft.name ?? "").trim();
          if (!name) {
            throw new Error("Name is required.");
          }
          if (config.providers.some((provider) => provider.name === name)) {
            throw new Error(`A provider named "${name}" already exists.`);
          }
          const options = providerOptionsTemplate(providerType) as Record<
            string,
            unknown
          >;
          for (const definition of providerFields) {
            if (definition.key === "openaiApi") {
              const nextValue = parseTypedFieldValue(
                providerDraft[definition.key] ?? "",
                definition,
              );
              options.api = nextValue;
              continue;
            }
            if (definition.kind === "reasoningEffort") {
              const effort = parseTypedFieldValue(
                providerDraft[definition.key] ?? "",
                definition,
              );
              const reasoning = {
                ...((options.reasoning as
                  Record<string, unknown> | undefined) ?? {}),
                effort,
              };
              options.reasoning = Object.values(reasoning).some(
                (value) => value !== undefined,
              )
                ? reasoning
                : undefined;
              continue;
            }
            if (definition.kind === "reasoningSummary") {
              const summary = parseTypedFieldValue(
                providerDraft[definition.key] ?? "",
                definition,
              );
              const reasoning = {
                ...((options.reasoning as
                  Record<string, unknown> | undefined) ?? {}),
                summary,
              };
              options.reasoning = Object.values(reasoning).some(
                (value) => value !== undefined,
              )
                ? reasoning
                : undefined;
              continue;
            }
            if (definition.kind === "reasoningDisplay") {
              const display = parseTypedFieldValue(
                providerDraft[definition.key] ?? "",
                definition,
              );
              const reasoning = {
                ...((options.reasoning as
                  Record<string, unknown> | undefined) ?? {}),
                display,
              };
              options.reasoning = Object.values(reasoning).some(
                (value) => value !== undefined,
              )
                ? reasoning
                : undefined;
              continue;
            }
            if (definition.kind === "bedrockCredentials") {
              const accessKeyId = normalizeOptional(
                providerDraft.accessKeyId ?? "",
              );
              const secretAccessKey = normalizeOptional(
                providerDraft.secretAccessKey ?? "",
              );
              if (
                (accessKeyId === undefined) !==
                (secretAccessKey === undefined)
              ) {
                throw new Error(
                  "Access key ID and secret access key must be provided together.",
                );
              }
              options.accessKeyId = accessKeyId;
              options.secretAccessKey = secretAccessKey;
              continue;
            }
            if (definition.kind === "promptCache") {
              continue;
            }
            options[definition.key] = parseTypedFieldValue(
              providerDraft[definition.key] ?? "",
              definition,
            );
          }
          if (
            updateConfig(
              {
                providers: addProviderEntry({
                  name,
                  provider: providerType,
                  options: options,
                } as ProviderEntry),
              },
              `Added provider "${name}" as "${providerType}".`,
            )
          ) {
            setProviderDraft(null);
            setProviderDraftType(null);
            setScreen({ kind: "config-provider-edit", name });
          }
        },
      },
      {
        label: "Back",
        value: () => {
          setProviderDraft(null);
          setProviderDraftType(null);
          setScreen({ kind: "config-providers" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Add a new provider"
        description="Select a field to edit, then save when you're done."
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderProviderEditMenu = () => {
    if (screen.kind !== "config-provider-edit") {
      return null;
    }
    const { name } = screen;
    const entry = config.providers.find((provider) => provider.name === name);
    if (!entry) {
      return null;
    }
    const usageCount = providerUsageCount(entry.name);
    const providerFields = PROVIDER_FIELD_DEFINITIONS[entry.provider];
    const providerOptions = entry.options as Record<string, unknown>;

    const items: MenuItem[] = [
      {
        label: `Name • ${entry.name}`,
        value: () =>
          promptValue({
            title: "Rename provider",
            label: "Name",
            initialValue: entry.name,
            onSubmit: async (value) => {
              const next = value.trim();
              if (!next) {
                throw new Error("Name is required.");
              }
              if (next === entry.name) {
                setPrompt(null);
                return;
              }
              if (config.providers.some((provider) => provider.name === next)) {
                throw new Error(`A provider named "${next}" already exists.`);
              }
              if (
                updateConfig(
                  renameProvider(entry.name, next),
                  `Renamed provider "${entry.name}" to "${next}".`,
                )
              ) {
                setPrompt(null);
                setScreen({ kind: "config-provider-edit", name: next });
              }
            },
          }),
      },
      {
        label: `Type • ${entry.provider}`,
        value: () =>
          setScreen({ kind: "config-provider-type", name: entry.name }),
      },
      ...providerFields.map(
        (definition) =>
          ({
            key: `provider-field:${entry.name}:${definition.key}`,
            label: `${definition.label} • ${formatTypedFieldValue(
              definition,
              definition.kind === "bedrockCredentials"
                ? providerOptions.accessKeyId && providerOptions.secretAccessKey
                : definition.kind === "reasoningEffort"
                  ? (
                      providerOptions.reasoning as
                        { effort?: unknown } | undefined
                    )?.effort
                  : definition.kind === "reasoningSummary"
                    ? (
                        providerOptions.reasoning as
                          { summary?: unknown } | undefined
                      )?.summary
                    : definition.kind === "reasoningDisplay"
                      ? (
                          providerOptions.reasoning as
                            { display?: unknown } | undefined
                        )?.display
                      : definition.kind === "promptCache"
                        ? formatPromptCacheSummary(providerOptions.promptCache)
                        : providerOptions[definition.key],
            )}`,
            value: () => {
              if (definition.kind === "openaiApi") {
                setScreen({
                  kind: "config-provider-openai-api",
                  name: entry.name,
                });
                return;
              }
              if (definition.kind === "reasoningEffort") {
                setScreen({
                  kind: "config-provider-reasoning-effort",
                  name: entry.name,
                });
                return;
              }
              if (definition.kind === "reasoningSummary") {
                setScreen({
                  kind: "config-provider-reasoning-summary",
                  name: entry.name,
                });
                return;
              }
              if (definition.kind === "reasoningDisplay") {
                setScreen({
                  kind: "config-provider-reasoning-display",
                  name: entry.name,
                });
                return;
              }
              if (definition.kind === "promptCache") {
                setScreen({
                  kind: "config-provider-prompt-cache",
                  name: entry.name,
                });
                return;
              }
              if (definition.kind === "optionalBoolean") {
                const currentValue = providerOptions[definition.key];
                const nextValue = currentValue === true ? false : true;
                updateConfig(
                  {
                    providers: patchProvider(entry.name, {
                      [definition.key]: nextValue,
                    }),
                  },
                  `Updated ${definition.label.toLowerCase()} for "${entry.name}" to ${nextValue ? "yes" : "no"}.`,
                );
                return;
              }
              if (definition.kind === "bedrockCredentials") {
                promptValue({
                  title: "Update static credentials",
                  label: "Access key ID",
                  initialValue:
                    typeof providerOptions.accessKeyId === "string"
                      ? providerOptions.accessKeyId
                      : "",
                  placeholder: "AKIA...",
                  note: definition.note,
                  onSubmit: async (accessKeyIdValue) => {
                    promptValue({
                      title: "Update static credentials",
                      label: "Secret access key",
                      initialValue:
                        typeof providerOptions.secretAccessKey === "string"
                          ? providerOptions.secretAccessKey
                          : "",
                      placeholder: "...",
                      onSubmit: async (secretAccessKeyValue) => {
                        const accessKeyId = normalizeOptional(accessKeyIdValue);
                        const secretAccessKey =
                          normalizeOptional(secretAccessKeyValue);
                        if (
                          (accessKeyId === undefined) !==
                          (secretAccessKey === undefined)
                        ) {
                          throw new Error(
                            "Access key ID and secret access key must be provided together.",
                          );
                        }
                        if (
                          updateConfig(
                            {
                              providers: patchProvider(entry.name, {
                                accessKeyId,
                                secretAccessKey,
                              }),
                            },
                            `Updated static credentials for "${entry.name}".`,
                          )
                        ) {
                          setPrompt(null);
                        }
                      },
                    });
                  },
                });
                return;
              }
              promptValue({
                title: `Update ${definition.label}`,
                label: definition.label,
                initialValue:
                  definition.kind === "stringRecord"
                    ? providerOptions[definition.key]
                      ? compactJson(providerOptions[definition.key])
                      : ""
                    : providerOptions[definition.key] !== undefined
                      ? String(providerOptions[definition.key])
                      : "",
                placeholder: definition.placeholder,
                note: definition.note,
                onSubmit: async (value) => {
                  const nextValue = parseTypedFieldValue(value, definition);
                  if (
                    updateConfig(
                      {
                        providers: patchProvider(entry.name, {
                          [definition.key]: nextValue,
                        }),
                      },
                      `Updated ${definition.label.toLowerCase()} for "${entry.name}".`,
                    )
                  ) {
                    setPrompt(null);
                  }
                },
              });
            },
          }) satisfies MenuItem,
      ),
      ...(usageCount > 0
        ? []
        : [
            {
              label: `Delete "${entry.name}"`,
              boldSubstring: entry.name,
              value: () =>
                setScreen({
                  kind: "config-provider-delete-confirm",
                  name: entry.name,
                }),
            } satisfies MenuItem,
          ]),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-providers" }),
      },
    ];

    return (
      <MenuScreen
        title={`Edit Provider • ${entry.name}`}
        description={
          usageCount > 0
            ? `Used by ${usageCount} model(s). Rename updates references automatically; delete is disabled while in use.`
            : "Edit shared provider settings or delete this provider."
        }
        items={items}
      />
    );
  };

  const renderOpenAIApiMenu = () => {
    if (screen.kind !== "config-provider-openai-api") {
      return null;
    }
    const entry = config.providers.find(
      (provider) => provider.name === screen.name,
    );
    if (!entry) {
      return null;
    }
    const current = "api" in entry.options ? entry.options.api : undefined;
    const items: MenuItem[] = [
      {
        label:
          current === undefined
            ? "Not set (responses) • current"
            : "Not set (clear value)",
        value: () => {
          if (
            updateConfig(
              { providers: patchProvider(entry.name, { api: undefined }) },
              `Cleared API for "${entry.name}".`,
            )
          ) {
            setScreen({ kind: "config-provider-edit", name: entry.name });
          }
        },
      },
      ...(["responses", "chat"] as const).map((value) => ({
        label: current === value ? `${value} • current` : value,
        value: () => {
          if (
            updateConfig(
              { providers: patchProvider(entry.name, { api: value }) },
              `Updated API for "${entry.name}" to "${value}".`,
            )
          ) {
            setScreen({ kind: "config-provider-edit", name: entry.name });
          }
        },
      })),
      {
        label: "Back",
        value: () =>
          setScreen({ kind: "config-provider-edit", name: entry.name }),
      },
    ];

    return (
      <MenuScreen
        title={`Choose API • ${entry.name}`}
        description='Pick one: "responses" (default, streams reasoning) or "chat" (compatibility mode).'
        items={items}
      />
    );
  };

  const renderOpenAIEnumMenu = (
    screenKind:
      | "config-provider-reasoning-effort"
      | "config-provider-reasoning-summary"
      | "config-provider-reasoning-display",
    subKey: "effort" | "summary" | "display",
    title: string,
    description: string,
    values: readonly string[],
    clearedLabel: string,
  ) => {
    if (screen.kind !== screenKind) {
      return null;
    }
    const entry = config.providers.find(
      (provider) => provider.name === screen.name,
    );
    if (!entry) {
      return null;
    }
    const reasoning =
      "reasoning" in entry.options
        ? ((entry.options as Record<string, unknown>).reasoning as
            Record<string, unknown> | undefined)
        : undefined;
    const current = reasoning?.[subKey];
    // Merge into the sibling reasoning key, collapsing to `undefined` when the
    // object would end up empty so we never persist `"reasoning": {}`.
    const patchReasoning = (next: string | undefined) => {
      const merged = { ...(reasoning ?? {}), [subKey]: next };
      const hasValues = Object.values(merged).some((v) => v !== undefined);
      return patchProvider(entry.name, {
        reasoning: hasValues ? merged : undefined,
      });
    };
    const items: MenuItem[] = [
      {
        label: current === undefined ? clearedLabel : "Not set (clear value)",
        value: () => {
          if (
            updateConfig(
              { providers: patchReasoning(undefined) },
              `Cleared reasoning.${subKey} for "${entry.name}".`,
            )
          ) {
            setScreen({ kind: "config-provider-edit", name: entry.name });
          }
        },
      },
      ...values.map((value) => ({
        label: current === value ? `${value} • current` : value,
        value: () => {
          if (
            updateConfig(
              { providers: patchReasoning(value) },
              `Updated reasoning.${subKey} for "${entry.name}" to "${value}".`,
            )
          ) {
            setScreen({ kind: "config-provider-edit", name: entry.name });
          }
        },
      })),
      {
        label: "Back",
        value: () =>
          setScreen({ kind: "config-provider-edit", name: entry.name }),
      },
    ];
    return <MenuScreen title={title} description={description} items={items} />;
  };

  /**
   * The mlx `promptCache` provider field: unset/`null`/`false` disables
   * caching entirely; an object (even `{}`) enables it, with `minTokens`/
   * `maxEntries`/`ttl` overriding mlex's own pool-sizing defaults (8/16/300s).
   * Setting any of the three fields below auto-enables caching if it was
   * disabled; the "Enabled" toggle exists for turning caching on with pure
   * defaults (or off, dropping any overrides) without touching a field.
   */
  const renderPromptCacheMenu = () => {
    if (screen.kind !== "config-provider-prompt-cache") {
      return null;
    }
    const entry = config.providers.find(
      (provider) => provider.name === screen.name,
    );
    if (!entry) {
      return null;
    }
    const current =
      "promptCache" in entry.options
        ? ((entry.options as Record<string, unknown>).promptCache as
            | { minTokens?: number; maxEntries?: number; ttl?: number }
            | false
            | null
            | undefined)
        : undefined;
    const enabled =
      current !== undefined && current !== null && current !== false;
    const poolConfig = enabled ? current : undefined;

    const patchField = (
      key: "minTokens" | "maxEntries" | "ttl",
      next: number | undefined,
    ) => {
      const merged = { ...(poolConfig ?? {}), [key]: next };
      return patchProvider(entry.name, { promptCache: merged });
    };

    const numberField = (
      key: "minTokens" | "maxEntries" | "ttl",
      label: string,
      placeholder: string,
      note: string,
    ): MenuItem => ({
      label: `${label} • ${poolConfig?.[key] !== undefined ? poolConfig[key] : "default"}`,
      value: () =>
        promptValue({
          title: `Update ${label}`,
          label,
          initialValue:
            poolConfig?.[key] !== undefined ? String(poolConfig[key]) : "",
          placeholder,
          note,
          onSubmit: async (value) => {
            const trimmed = normalizeOptional(value);
            const next =
              trimmed === undefined
                ? undefined
                : parseNumber(trimmed, label, {
                    integer: true,
                    min: key === "minTokens" ? 0 : 1,
                  });
            if (
              updateConfig(
                { providers: patchField(key, next) },
                `Updated prompt-cache ${key} for "${entry.name}".`,
              )
            ) {
              setPrompt(null);
            }
          },
        }),
    });

    const items: MenuItem[] = [
      {
        label: `Enabled • ${enabled ? "Yes" : "No"}`,
        value: () => {
          const next = enabled ? undefined : (poolConfig ?? {});
          if (
            updateConfig(
              { providers: patchProvider(entry.name, { promptCache: next }) },
              `${enabled ? "Disabled" : "Enabled"} prompt cache for "${entry.name}".`,
            )
          ) {
            setScreen({
              kind: "config-provider-prompt-cache",
              name: entry.name,
            });
          }
        },
      },
      numberField(
        "maxEntries",
        "Max entries",
        "16",
        "Maximum cached prefixes kept at once (LRU-evicted beyond this). Leave blank for mlex's default (16).",
      ),
      numberField(
        "ttl",
        "TTL (seconds)",
        "300",
        "How long an unused cache entry is kept before eviction. Leave blank for mlex's default (300, i.e. 5 minutes).",
      ),
      numberField(
        "minTokens",
        "Min cacheable tokens",
        "8",
        "Prompts shorter than this many tokens are never cached. Leave blank for mlex's default (8).",
      ),
      {
        label: "Back",
        value: () =>
          setScreen({ kind: "config-provider-edit", name: entry.name }),
      },
    ];

    return (
      <MenuScreen
        title={`Prompt Cache • ${entry.name}`}
        description="Sizing for mlex's internal prompt-cache pool, applied once when the model loads. Setting any field below also enables caching if it was disabled."
        items={items}
      />
    );
  };

  const renderProviderTypeMenu = () => {
    if (screen.kind !== "config-provider-type") {
      return null;
    }
    const { name } = screen;
    const entry = config.providers.find((provider) => provider.name === name);
    if (!entry) {
      return null;
    }
    const items: MenuItem[] = [
      ...SUPPORTED_PROVIDER_TYPES.map((provider) => ({
        label: provider === entry.provider ? `${provider} • current` : provider,
        value: () => {
          if (
            updateConfig(
              {
                providers: config.providers.map((item) =>
                  item.name === entry.name
                    ? {
                        ...item,
                        provider,
                        options: providerOptionsTemplate(provider),
                      }
                    : item,
                ),
              },
              `Updated provider type for "${entry.name}" to "${provider}" and scaffolded options.`,
            )
          ) {
            setScreen({ kind: "config-provider-edit", name: entry.name });
          }
        },
      })),
      {
        label: "Back",
        value: () =>
          setScreen({ kind: "config-provider-edit", name: entry.name }),
      },
    ];

    return (
      <MenuScreen
        title={`Choose Provider Type • ${entry.name}`}
        description="Pick which runtime provider this shared config targets."
        items={items}
      />
    );
  };

  const renderProviderAddTypeMenu = () => {
    if (screen.kind !== "config-provider-add-type") {
      return null;
    }
    const { name } = screen;
    const items: MenuItem[] = [
      ...SUPPORTED_PROVIDER_TYPES.map((provider) => ({
        label: provider,
        value: () => {
          if (
            updateConfig(
              { providers: addProvider(name, provider) },
              `Added provider "${name}" as "${provider}".`,
            )
          ) {
            setScreen({ kind: "config-provider-edit", name });
          }
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-providers" }),
      },
    ];

    return (
      <MenuScreen
        title={`Choose Provider Type • ${name}`}
        description="Pick the runtime provider before creating this shared config."
        items={items}
      />
    );
  };

  const renderProviderDeleteConfirm = () => {
    if (screen.kind !== "config-provider-delete-confirm") {
      return null;
    }
    const { name } = screen;
    const items: MenuItem[] = [
      {
        key: `provider-del-cancel:${name}`,
        label: "No — keep provider",
        value: () => setScreen({ kind: "config-provider-edit", name }),
      },
      {
        key: `provider-del-confirm:${name}`,
        label: "Yes — remove provider",
        value: () => {
          if (
            updateConfig(
              { providers: removeProvider(name) },
              `Deleted provider "${name}".`,
            )
          ) {
            setScreen({ kind: "config-providers" });
          }
        },
      },
    ];

    return (
      <MenuScreen
        title="Delete provider?"
        description={`Remove "${name}" from the configured providers?`}
        items={items}
      />
    );
  };

  const renderLlmsMenu = () => {
    const llmItems: MenuItem[] = config.llms.map((m) => ({
      key: `llm:${m.name}`,
      label: `${m.name} • ${llmSummary(m)}${m.default ? " • default" : ""}`,
      boldSubstring: m.name,
      value: () => setScreen({ kind: "config-llm-edit", name: m.name }),
    }));

    const items: MenuItem[] = [
      {
        label: "Add LLM",
        value: () => {
          if (config.providers.length === 0) {
            throw new Error(
              "Add at least one provider first so the model can reference it.",
            );
          }
          const providerName = config.providers[0]!.name;
          const providerType = config.providers[0]!.provider;
          setLlmDraft({
            name: "",
            provider: providerName,
            model: defaultModelForProviderType(providerType),
            temperature: "",
            maxTokens: "",
            context: "",
          });
          setScreen({ kind: "config-llm-create" });
        },
      },
      ...llmItems,
      {
        label: "Back",
        value: () => setScreen({ kind: "config" }),
      },
    ];

    return (
      <MenuScreen
        title="LLMs"
        description="Add, edit, or remove named LLM configurations. The default is used for new sessions."
        items={items}
      />
    );
  };

  const renderLlmCreateMenu = () => {
    if (screen.kind !== "config-llm-create" || !llmDraft) {
      return null;
    }
    const provider = config.providers.find(
      (candidate) => candidate.name === llmDraft.provider,
    );
    const providerType = provider?.provider;
    const items: MenuItem[] = [
      {
        label: `Name • ${llmDraft.name?.trim() ? llmDraft.name : "not set"}`,
        value: () => editLlmDraftField("Name", "name", llmDraft.name ?? ""),
      },
      {
        label: `Provider • ${llmDraft.provider ?? "not set"}`,
        value: () => setScreen({ kind: "config-llm-create-provider" }),
      },
      {
        label: `Model • ${llmDraft.model?.trim() ? llmDraft.model : "not set"}`,
        value: () =>
          editLlmDraftField(
            "Model",
            "model",
            llmDraft.model ?? "",
            providerType
              ? `Suggested default for ${providerType}: ${defaultModelForProviderType(providerType)}`
              : undefined,
          ),
      },
      ...LLM_FIELD_DEFINITIONS.map((definition) => ({
        key: `llm-create-field:${definition.key}`,
        label: `${definition.label} • ${formatDraftFieldValue(
          {
            key: definition.key,
            label: definition.label,
            placeholder: definition.placeholder,
            note: definition.note,
          },
          llmDraft[definition.key],
        )}`,
        value: () =>
          editLlmDraftField(
            definition.label,
            definition.key,
            llmDraft[definition.key] ?? "",
            definition.note,
          ),
      })),
      {
        label: "Save",
        value: () => {
          const name = (llmDraft.name ?? "").trim();
          if (!name) {
            throw new Error("Name is required.");
          }
          if (config.llms.some((llm) => llm.name === name)) {
            throw new Error(`An LLM named "${name}" already exists.`);
          }
          const providerName = (llmDraft.provider ?? "").trim();
          if (!providerName) {
            throw new Error("Provider is required.");
          }
          const selectedProvider = config.providers.find(
            (candidate) => candidate.name === providerName,
          );
          if (!selectedProvider) {
            throw new Error(`Provider "${providerName}" does not exist.`);
          }
          const model = (llmDraft.model ?? "").trim();
          if (!model) {
            throw new Error("Model is required.");
          }
          const options: Record<string, unknown> = { model };
          for (const definition of LLM_FIELD_DEFINITIONS) {
            options[definition.key] = parseTypedFieldValue(
              llmDraft[definition.key] ?? "",
              definition,
            );
          }
          if (
            updateConfig(
              {
                llms: addLlmEntry({
                  name,
                  provider: providerName,
                  options: options as LlmEntry["options"],
                  default: false,
                }),
              },
              `Added LLM "${name}".`,
            )
          ) {
            setLlmDraft(null);
            setScreen({ kind: "config-llm-edit", name });
          }
        },
      },
      {
        label: "Back",
        value: () => {
          setLlmDraft(null);
          setScreen({ kind: "config-llms" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Add a new LLM"
        description="Select a field to edit, then save when you're done."
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderLlmEditMenu = () => {
    if (screen.kind !== "config-llm-edit") {
      return null;
    }
    const { name } = screen;
    const entry = config.llms.find((m) => m.name === name);
    if (!entry) {
      return null;
    }
    const isOnly = config.llms.length === 1;
    const isDefault = entry.default;
    const llmOptions = entry.options as Record<string, unknown>;

    const items: MenuItem[] = [
      {
        label: `Name • ${entry.name}`,
        value: () =>
          promptValue({
            title: "Rename LLM",
            label: "Name",
            initialValue: entry.name,
            onSubmit: async (value) => {
              const next = value.trim();
              if (!next) {
                throw new Error("Name is required.");
              }
              if (next === entry.name) {
                setPrompt(null);
                return;
              }
              if (config.llms.some((m) => m.name === next)) {
                throw new Error(`An LLM named "${next}" already exists.`);
              }
              if (
                updateConfig(
                  { llms: renameLlm(entry.name, next) },
                  `Renamed "${entry.name}" to "${next}".`,
                )
              ) {
                setPrompt(null);
                setScreen({ kind: "config-llm-edit", name: next });
              }
            },
          }),
      },
      {
        label: `Provider • ${entry.provider}`,
        value: () =>
          setScreen({ kind: "config-llm-provider", name: entry.name }),
      },
      {
        label: `Model • ${entry.options.model}`,
        value: () =>
          promptValue({
            title: "Update model id",
            label: "Model",
            initialValue: entry.options.model,
            note: (() => {
              const providerType = config.providers.find(
                (provider) => provider.name === entry.provider,
              )?.provider;
              return providerType
                ? `Suggested default for ${providerType}: ${defaultModelForProviderType(providerType)}`
                : undefined;
            })(),
            onSubmit: async (value) => {
              const model = value.trim();
              if (!model) {
                throw new Error("Model is required.");
              }
              if (
                updateConfig(
                  { llms: patchLlm(entry.name, { model }) },
                  "Updated model id.",
                )
              ) {
                setPrompt(null);
              }
            },
          }),
      },
      ...LLM_FIELD_DEFINITIONS.map(
        (definition) =>
          ({
            key: `llm-field:${entry.name}:${definition.key}`,
            label: `${definition.label} • ${formatTypedFieldValue(
              definition,
              llmOptions[definition.key],
            )}`,
            value: () =>
              promptValue({
                title: `Update ${definition.label}`,
                label: definition.label,
                initialValue:
                  llmOptions[definition.key] !== undefined
                    ? String(llmOptions[definition.key])
                    : "",
                placeholder: definition.placeholder,
                note: definition.note,
                onSubmit: async (value) => {
                  const nextValue = parseTypedFieldValue(value, definition);
                  if (
                    updateConfig(
                      {
                        llms: patchLlm(entry.name, {
                          [definition.key]: nextValue,
                        }),
                      },
                      `Updated ${definition.label.toLowerCase()} for "${entry.name}".`,
                    )
                  ) {
                    setPrompt(null);
                  }
                },
              }),
          }) satisfies MenuItem,
      ),
      {
        label: isDefault ? "Default • yes" : "Set as default",
        value: () => {
          if (isDefault) {
            return;
          }
          updateConfig(
            { llms: setDefaultLlm(entry.name) },
            `Set "${entry.name}" as default LLM.`,
          );
        },
      },
      ...(isOnly || isDefault
        ? []
        : [
            {
              label: `Delete "${entry.name}"`,
              boldSubstring: entry.name,
              value: () =>
                setScreen({
                  kind: "config-llm-delete-confirm",
                  name: entry.name,
                }),
            } satisfies MenuItem,
          ]),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-llms" }),
      },
    ];

    return (
      <MenuScreen
        title={`Edit LLM • ${entry.name}`}
        description={
          isOnly
            ? "This is the only LLM and cannot be deleted."
            : isDefault
              ? "This is the default LLM. Set another as default to enable deletion."
              : "Edit fields, set as default, or delete this LLM."
        }
        items={items}
      />
    );
  };

  const renderLlmCreateProviderMenu = () => {
    if (screen.kind !== "config-llm-create-provider" || !llmDraft) {
      return null;
    }
    const items: MenuItem[] = [
      ...config.providers.map((provider) => ({
        label:
          provider.name === llmDraft.provider
            ? `${provider.name} • current`
            : `${provider.name} • ${provider.provider}`,
        value: () => {
          setLlmDraft((current) =>
            current
              ? {
                  ...current,
                  provider: provider.name,
                  model: defaultModelForProviderType(provider.provider),
                }
              : current,
          );
          setScreen({ kind: "config-llm-create" });
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-llm-create" }),
      },
    ];

    return (
      <MenuScreen
        title="Choose provider"
        description="Pick which shared provider config this LLM should use."
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderLlmProviderMenu = () => {
    if (screen.kind !== "config-llm-provider") {
      return null;
    }
    const { name } = screen;
    const entry = config.llms.find((m) => m.name === name);
    if (!entry) {
      return null;
    }
    const items: MenuItem[] = [
      ...config.providers.map((provider) => ({
        label:
          provider.name === entry.provider
            ? `${provider.name} • current`
            : `${provider.name} • ${provider.provider}`,
        value: () => {
          if (
            updateConfig(
              {
                llms: config.llms.map((llm) =>
                  llm.name === entry.name
                    ? {
                        ...llm,
                        provider: provider.name,
                        options: {
                          ...llm.options,
                          model: defaultModelForProviderType(provider.provider),
                        },
                      }
                    : llm,
                ),
              },
              `Updated provider for "${entry.name}" to "${provider.name}" and scaffolded its default model.`,
            )
          ) {
            setScreen({ kind: "config-llm-edit", name: entry.name });
          }
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-llm-edit", name: entry.name }),
      },
    ];

    return (
      <MenuScreen
        title={`Choose Provider • ${entry.name}`}
        description="Pick which shared provider config this LLM should use."
        items={items}
      />
    );
  };

  const renderLlmDeleteConfirm = () => {
    if (screen.kind !== "config-llm-delete-confirm") {
      return null;
    }
    const { name } = screen;
    const items: MenuItem[] = [
      {
        key: `llm-del-cancel:${name}`,
        label: "No — keep LLM",
        value: () => setScreen({ kind: "config-llm-edit", name }),
      },
      {
        key: `llm-del-confirm:${name}`,
        label: "Yes — remove LLM",
        value: () => {
          if (
            updateConfig({ llms: removeLlm(name) }, `Deleted LLM "${name}".`)
          ) {
            setScreen({ kind: "config-llms" });
          }
        },
      },
    ];

    return (
      <MenuScreen
        title="Delete LLM?"
        description={`Remove "${name}" from the configured LLMs?`}
        items={items}
      />
    );
  };

  const renderPromptsConfigMenu = () => {
    const promptKeys = Object.keys(
      PROMPT_LABELS,
    ) as (keyof ConfigData["prompts"])[];
    const items: MenuItem[] = [
      ...promptKeys.map((key) => {
        const enabled = configData.prompts[key];
        const label = PROMPT_LABELS[key];
        return {
          label: `${label} • ${yesNo(enabled)}`,
          value: () => {
            if (
              updateConfig(
                {
                  prompts: {
                    ...config.prompts,
                    [key]: !enabled,
                  },
                },
                `${label} prompt ${enabled ? "disabled" : "enabled"}.`,
              )
            ) {
              setScreen({ kind: "config-prompts" });
            }
          },
        };
      }),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-general" }),
      },
    ];

    return (
      <MenuScreen
        title="Prompts"
        description="Choose which bundled harness prompt sections are included in future sessions."
        items={items}
      />
    );
  };

  const renderSearchProviderMenu = () => {
    const items: MenuItem[] = [
      ...(
        ["brave", "exa", "firecrawl", "litellm", "serper", "tavily"] as const
      ).map((provider) => ({
        label:
          provider === configData.search.provider
            ? `${SEARCH_PROVIDER_LABELS[provider]} • current`
            : SEARCH_PROVIDER_LABELS[provider],
        value: () => {
          if (
            updateConfig(
              {
                search: {
                  ...config.search,
                  provider,
                },
              },
              `Updated search provider to "${SEARCH_PROVIDER_LABELS[provider]}".`,
            )
          ) {
            setScreen({ kind: "config-search" });
          }
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-search" }),
      },
    ];

    return (
      <MenuScreen
        title="Search Provider"
        description="Pick which web search provider to use."
        items={items}
      />
    );
  };

  const renderSearchConfigMenu = () => {
    const activeProvider = configData.search.provider;
    const activeProviderLabel = SEARCH_PROVIDER_LABELS[activeProvider];
    const isLiteLLM = activeProvider === "litellm";
    const credentialLabel = isLiteLLM ? "Virtual key" : "API key";
    const apiKey = configData.search[activeProvider].apiKey;
    const redacted = compactJson(
      maskSensitiveParamsForDisplay({ apiKey: apiKey ?? "" }),
    );
    const litellmItems: MenuItem[] = isLiteLLM
      ? [
          {
            label: `Base URL • ${truncate(configData.search.litellm.baseURL ?? "(unset)", 44)}`,
            value: () =>
              promptValue({
                title: "Update LiteLLM base URL",
                label: "Base URL",
                initialValue: configData.search.litellm.baseURL ?? "",
                onSubmit: async (value) => {
                  const nextBaseURL = value.trim();
                  if (!nextBaseURL) {
                    throw new Error("Base URL is required.");
                  }
                  if (
                    updateConfig(
                      {
                        search: {
                          ...config.search,
                          litellm: {
                            ...config.search.litellm,
                            baseURL: nextBaseURL,
                          },
                        },
                      },
                      "Updated LiteLLM base URL.",
                    )
                  ) {
                    setPrompt(null);
                  }
                },
              }),
          },
          {
            label: `Search tool • ${configData.search.litellm.tool ?? "(unset)"}`,
            value: () =>
              promptValue({
                title: "Update LiteLLM search tool",
                label: "Search tool name",
                initialValue: configData.search.litellm.tool ?? "",
                onSubmit: async (value) => {
                  const nextSearchTool = value.trim();
                  if (!nextSearchTool) {
                    throw new Error("Search tool name is required.");
                  }
                  if (
                    updateConfig(
                      {
                        search: {
                          ...config.search,
                          litellm: {
                            ...config.search.litellm,
                            tool: nextSearchTool,
                          },
                        },
                      },
                      "Updated LiteLLM search tool.",
                    )
                  ) {
                    setPrompt(null);
                  }
                },
              }),
          },
        ]
      : [];
    const items: MenuItem[] = [
      {
        label: `Enabled • ${yesNo(configData.search.enabled)}`,
        value: () => {
          if (
            updateConfig(
              {
                search: {
                  ...config.search,
                  enabled: !configData.search.enabled,
                },
              },
              `Search tool ${configData.search.enabled ? "disabled" : "enabled"}.`,
            )
          ) {
            setScreen({ kind: "config-search" });
          }
        },
      },
      {
        label: `Provider • ${activeProviderLabel}`,
        value: () => setScreen({ kind: "config-search-provider" }),
      },
      ...litellmItems,
      {
        label: `${activeProviderLabel} ${credentialLabel.toLowerCase()} • ${truncate(redacted, 44)}`,
        value: () =>
          promptValue({
            title: `Update ${activeProviderLabel} ${credentialLabel.toLowerCase()}`,
            label: credentialLabel,
            initialValue: apiKey ?? "",
            onSubmit: async (value) => {
              const nextApiKey = value.trim();
              if (!nextApiKey) {
                throw new Error(`${credentialLabel} is required.`);
              }
              if (
                updateConfig(
                  {
                    search: {
                      ...config.search,
                      [activeProvider]: {
                        ...config.search[activeProvider],
                        apiKey: nextApiKey,
                      },
                    },
                  },
                  `Updated ${activeProviderLabel} ${credentialLabel.toLowerCase()}.`,
                )
              ) {
                setPrompt(null);
              }
            },
          }),
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "config-tools" }),
      },
    ];

    return (
      <MenuScreen
        title="Search"
        description="Configure web search provider and credentials."
        items={items}
      />
    );
  };

  const renderMcpStdioEditMenu = () => {
    if (screen.kind !== "mcp-stdio-edit" || !mcpDraft) {
      return null;
    }
    const items: MenuItem[] = [
      ...MCP_STDIO_FIELDS.map((field) => ({
        key: `mcp-stdio:${field.key}`,
        label: `${field.label} • ${formatDraftFieldValue(field, mcpDraft[field.key])}`,
        value: () => editMcpDraftField(field, mcpDraft[field.key] ?? ""),
      })),
      {
        label: "Save",
        value: () => saveMcpStdioDraft(screen.originalName),
      },
      {
        label: "Back",
        value: () => {
          setMcpDraft(null);
          setScreen({ kind: "mcp" });
        },
      },
    ];

    return (
      <MenuScreen
        title={`${screen.originalName ? "Edit" : "Add"} stdio server`}
        description="Select a field to edit, then save when you're done."
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderMcpRemoteEditMenu = () => {
    if (screen.kind !== "mcp-remote-edit" || !mcpDraft) {
      return null;
    }
    const fields = [
      ...MCP_REMOTE_BASE_FIELDS,
      ...(isTruthyToggle(mcpDraft.oauthEnabled) ? MCP_REMOTE_OAUTH_FIELDS : []),
    ];
    const items: MenuItem[] = [
      ...fields.map((field) => ({
        key: `mcp-remote:${field.key}`,
        label: `${field.label} • ${formatDraftFieldValue(field, mcpDraft[field.key])}`,
        value: () => {
          if (field.key === "oauthEnabled") {
            updateMcpDraftField(
              field.key,
              isTruthyToggle(mcpDraft[field.key]) ? "no" : "yes",
            );
            return;
          }
          editMcpDraftField(field, mcpDraft[field.key] ?? "");
        },
      })),
      {
        label: "Save",
        value: () =>
          saveMcpRemoteDraft(screen.transportType, screen.originalName),
      },
      {
        label: "Back",
        value: () => {
          setMcpDraft(null);
          setScreen({ kind: "mcp" });
        },
      },
    ];

    return (
      <MenuScreen
        title={`${
          screen.originalName ? "Edit" : "Add"
        } ${screen.transportType} server`}
        description="Select a field to edit, then save when you're done."
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderMcpSaveTargetMenu = () => {
    if (screen.kind !== "mcp-save-target") {
      return null;
    }
    const targets = mcpConfig.writableTargets();
    const saveToTarget = (path: string) => {
      try {
        if (screen.transportType === "stdio") {
          const { name, transport } = buildMcpStdioDraft();
          persistMcpTransport(undefined, name, transport, path);
        } else {
          const { name, transport } = buildMcpRemoteDraft(screen.transportType);
          persistMcpTransport(undefined, name, transport, path);
        }
      } catch (error) {
        handleActionError(error);
      }
    };

    const items: MenuItem[] = [
      ...targets.map((target) => ({
        key: `mcp-save-target:${target.path}`,
        label: `${target.scope === "global" ? "Global" : "Project"} • ${formatMcpWriteTargetLabel(target.path)}`,
        value: () => saveToTarget(target.path),
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "mcp" }),
      },
    ];

    return (
      <MenuScreen
        title="Choose save target"
        description="Select where to save this new MCP server."
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderMcpMenu = () => {
    const serverItems: MenuItem[] = mcpServers.map((server) => {
      const oauthStatus = mcpAuthStatuses[server.name];
      return {
        key: `mcp-server:${server.name}`,
        label: `Edit ${server.name} • ${formatMcpServerLabel(
          server.transport,
          oauthStatus,
        )} • ${formatMcpScope(server.scope)}`,
        boldSubstring: server.name,
        oauthStatus:
          oauthStatus === "authenticated" ||
          oauthStatus === "expired" ||
          oauthStatus === "unauthenticated"
            ? oauthStatus
            : undefined,
        value: () => {
          if (server.transport.type === "stdio") {
            openMcpStdioEditor(server.name, server.transport);
          } else {
            openMcpRemoteEditor(
              server.transport.type,
              server.name,
              server.transport,
            );
          }
        },
      };
    });

    const items: MenuItem[] = [
      {
        label: "Add stdio server",
        value: () => openMcpStdioEditor(),
      },
      {
        label: "Add streamable HTTP server",
        value: () => openMcpRemoteEditor("streamable-http"),
      },
      {
        label: "Add SSE server",
        value: () => openMcpRemoteEditor("sse"),
      },
      ...serverItems,
      {
        label: "Reload from disk",
        value: () => {
          mcpConfig.reload();
          refresh();
          setNotice({
            kind: "info",
            text: "Reloaded merged MCP config from disk.",
          });
        },
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];

    return (
      <MenuScreen
        title="MCP Servers"
        description="Add, edit, or remove named MCP transports from merged MCP config (global + project overlays)."
        items={items}
        footerHint={(item) =>
          formatMcpFooterHint(item, mcpServers, mcpAuthStatuses)
        }
        onActionError={handleActionError}
        onShortcut={async (input, item) => {
          const server = findMcpServerFromMenuItem(item, mcpServers);
          if (!server) {
            return;
          }
          const status = mcpAuthStatuses[server.name];
          const key = input.toLowerCase();
          if (key === "d") {
            setScreen({
              kind: "mcp-delete-confirm",
              name: server.name,
              sourcePath: server.sourcePath,
              scope: server.scope,
            });
            return;
          }
          if (
            key === "r" &&
            server.transport.type !== "stdio" &&
            status !== "unsupported"
          ) {
            await authenticateMcpServer(server.name);
            return;
          }
          if (
            key === "l" &&
            server.transport.type !== "stdio" &&
            (status === "authenticated" || status === "expired")
          ) {
            await logoutMcpServer(server.name);
          }
        }}
      />
    );
  };

  const renderSkillsMenu = () => {
    const skillItems: MenuItem[] = installedSkills.map((skill) => {
      const folder = folderNameForSkill(skill);
      return {
        label: `Remove ${skill.name} • ${folder}`,
        boldSubstring: skill.name,
        value: () =>
          setScreen({
            kind: "skills-delete-confirm",
            folder,
            displayName: skill.name,
          }),
      };
    });

    const items: MenuItem[] = [
      {
        label: "Search catalog and install",
        value: () =>
          promptValue({
            title: "Search skills catalog",
            label: "Query",
            placeholder: "github, playwright, slack...",
            onSubmit: async (value) => {
              const query = value.trim();
              if (query.length < 2) {
                throw new Error("Use at least 2 characters to search.");
              }
              setPrompt(null);
              await runTask(`Searching for "${query}"...`, async () => {
                const results = await skills.search(query);
                setSearchResults(results);
                setScreen({ kind: "skills-search-results", query });
                setNotice({
                  kind: "info",
                  text: `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}".`,
                });
              });
            },
          }),
      },
      {
        label: "Install from source",
        value: () =>
          promptValue({
            title: "Install skill from source",
            label: "Source",
            placeholder: "owner/repo, GitHub URL, or local path",
            onSubmit: async (value) => {
              const source = value.trim();
              if (!source) {
                throw new Error("Source is required.");
              }
              setPrompt(null);
              await runTask(`Installing ${source}...`, async () => {
                await skills.install(source);
                await refreshSkills("Refreshing installed skills...");
                setSuccess(`Installed skill from "${source}".`);
              });
            },
          }),
      },
      ...skillItems,
      {
        label: "Refresh installed skills",
        value: () => {
          void refreshSkills("Refreshing installed skills...");
        },
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];

    return (
      <MenuScreen
        title="Skills"
        description="Search, install, and remove skills under ~/.hooman/skills."
        items={items}
      />
    );
  };

  const renderMcpDeleteConfirm = () => {
    if (screen.kind !== "mcp-delete-confirm") {
      return null;
    }
    const { name, sourcePath, scope } = screen;
    const items: MenuItem[] = [
      {
        key: `mcp-del-cancel:${name}`,
        label: "No — keep server",
        value: () => setScreen({ kind: "mcp" }),
      },
      {
        key: `mcp-del-confirm:${name}`,
        label: `Yes — remove from ${formatMcpScope(scope)} mcp.json`,
        value: () => {
          try {
            mcpConfig.removeFromPath(sourcePath, name);
            refresh();
            setSuccess(
              `Deleted MCP server "${name}" from ${formatMcpScope(scope)} mcp.json.`,
            );
          } catch (error) {
            handleActionError(error);
          }
          setScreen({ kind: "mcp" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Delete MCP server?"
        description={formatMcpDeleteDescription(name, sourcePath, scope)}
        items={items}
        onActionError={handleActionError}
      />
    );
  };

  const renderSkillsDeleteConfirm = () => {
    if (screen.kind !== "skills-delete-confirm") {
      return null;
    }
    const { folder, displayName } = screen;
    const items: MenuItem[] = [
      {
        key: `skill-del-cancel:${folder}`,
        label: "No — keep skill",
        value: () => setScreen({ kind: "skills" }),
      },
      {
        key: `skill-del-confirm:${folder}`,
        label: "Yes — uninstall",
        value: async () => {
          await runTask(`Removing ${displayName}...`, async () => {
            await skills.delete(folder);
            await refreshSkills("Refreshing installed skills...");
            setSuccess(`Removed skill "${displayName}".`);
          });
          setScreen({ kind: "skills" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Remove skill?"
        description={`Uninstall "${displayName}" (${folder}) from ~/.hooman/skills?`}
        items={items}
      />
    );
  };

  const renderSearchResults = () => {
    const items: MenuItem[] = [
      ...searchResults.map((result) => ({
        label: truncate(
          `${result.name} • ${result.installs} installs • ${result.source || result.slug}`,
          100,
        ),
        boldSubstring: result.name,
        value: () => {
          const source = result.slug || result.source;
          void runTask(`Installing ${result.name}...`, async () => {
            await skills.install(source);
            await refreshSkills("Refreshing installed skills...");
            setScreen({ kind: "skills" });
            setSuccess(`Installed "${result.name}".`);
          });
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "skills" }),
      },
    ];

    return (
      <MenuScreen
        title={`Search Results • "${screen.kind === "skills-search-results" ? screen.query : ""}"`}
        description="Select a result to install it."
        items={items}
      />
    );
  };

  const body = (() => {
    if (busyMessage) {
      return <BusyScreen message={busyMessage} />;
    }
    if (prompt) {
      return <PromptForm prompt={prompt} onSubmit={handlePromptSubmit} />;
    }
    switch (screen.kind) {
      case "home":
        return renderHome();
      case "config-general":
        return renderGeneralMenu();
      case "config":
        return renderConfigMenu();
      case "config-providers":
        return renderProvidersMenu();
      case "config-provider-create":
        return renderProviderCreateMenu();
      case "config-provider-create-type":
        return renderProviderAddTypeMenu();
      case "config-provider-add-type":
        return renderProviderAddTypeMenu();
      case "config-provider-edit":
        return renderProviderEditMenu();
      case "config-provider-type":
        return renderProviderTypeMenu();
      case "config-provider-openai-api":
        return renderOpenAIApiMenu();
      case "config-provider-reasoning-effort":
        return renderOpenAIEnumMenu(
          "config-provider-reasoning-effort",
          "effort",
          `Choose Reasoning effort • ${screen.name}`,
          'Enables thinking/reasoning. Pick one: "minimal", "low", "medium", "high", or clear to disable. GPT-5 needs "medium"+ to show a summary.',
          ["minimal", "low", "medium", "high"],
          "Not set (off) • current",
        );
      case "config-provider-reasoning-summary":
        return renderOpenAIEnumMenu(
          "config-provider-reasoning-summary",
          "summary",
          `Choose Reasoning summary • ${screen.name}`,
          'Responses API only. Pick one: "auto" (default), "concise", "detailed", or "none".',
          ["auto", "concise", "detailed", "none"],
          "Not set (auto) • current",
        );
      case "config-provider-reasoning-display":
        return renderOpenAIEnumMenu(
          "config-provider-reasoning-display",
          "display",
          `Choose Reasoning display • ${screen.name}`,
          'Bedrock Claude / MiniMax only (not native Anthropic). "summarized" reveals reasoning on newer Bedrock Claude (Opus 4.7+) and switches to adaptive thinking; "omitted" hides it. Clear to keep the enabled+budget scheme.',
          ["summarized", "omitted"],
          "Not set • current",
        );
      case "config-provider-prompt-cache":
        return renderPromptCacheMenu();
      case "config-provider-delete-confirm":
        return renderProviderDeleteConfirm();
      case "config-llms":
        return renderLlmsMenu();
      case "config-llm-create":
        return renderLlmCreateMenu();
      case "config-llm-create-provider":
        return renderLlmCreateProviderMenu();
      case "config-llm-edit":
        return renderLlmEditMenu();
      case "config-llm-provider":
        return renderLlmProviderMenu();
      case "config-llm-delete-confirm":
        return renderLlmDeleteConfirm();
      case "config-prompts":
        return renderPromptsConfigMenu();
      case "config-tools":
        return renderToolsConfigMenu();
      case "config-search":
        return renderSearchConfigMenu();
      case "config-search-provider":
        return renderSearchProviderMenu();
      case "mcp":
        return renderMcpMenu();
      case "mcp-save-target":
        return renderMcpSaveTargetMenu();
      case "mcp-stdio-edit":
        return renderMcpStdioEditMenu();
      case "mcp-remote-edit":
        return renderMcpRemoteEditMenu();
      case "mcp-delete-confirm":
        return renderMcpDeleteConfirm();
      case "skills":
        return renderSkillsMenu();
      case "skills-delete-confirm":
        return renderSkillsDeleteConfirm();
      case "skills-search-results":
        return renderSearchResults();
      default:
        return null;
    }
  })();

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {notice ? (
        <Box marginTop={1}>
          <Text color={noticeColor(notice.kind)}>{notice.text}</Text>
        </Box>
      ) : null}

      {body}
    </Box>
  );
}

function formatMcpServerLabel(
  transport: Stdio | StreamableHttp | Sse,
  status: McpAuthStatus | undefined,
): string {
  const summary = transportSummary(transport);
  if (
    (status === "expired" || status === "unauthenticated") &&
    summary.endsWith(" • oauth")
  ) {
    return `${summary.slice(0, -" • oauth".length)} • oauth needed`;
  }
  return summary;
}

function findMcpServerFromMenuItem(
  item: MenuItem | undefined,
  servers: Array<{
    name: string;
    transport: Stdio | StreamableHttp | Sse;
    sourcePath: string;
    scope: McpConfigScope;
  }>,
): {
  name: string;
  transport: Stdio | StreamableHttp | Sse;
  sourcePath: string;
  scope: McpConfigScope;
} | null {
  if (!item?.key?.startsWith("mcp-server:")) {
    return null;
  }
  const serverName = item.key.slice("mcp-server:".length);
  return servers.find((server) => server.name === serverName) ?? null;
}

function formatMcpFooterHint(
  item: MenuItem | undefined,
  servers: Array<{
    name: string;
    transport: Stdio | StreamableHttp | Sse;
    sourcePath: string;
    scope: McpConfigScope;
  }>,
  statuses: Record<string, McpAuthStatus>,
): string {
  const server = findMcpServerFromMenuItem(item, servers);
  const status = server ? statuses[server.name] : undefined;
  const parts = ["enter: edit"];
  if (server && server.transport.type !== "stdio" && status !== "unsupported") {
    parts.push(status === "authenticated" ? "r: re-auth" : "r: authenticate");
    if (status === "authenticated" || status === "expired") {
      parts.push("l: logout");
    }
  }
  if (server) {
    parts.push("d: delete");
  }
  parts.push("esc: back", "ctrl+c: exit");
  return parts.join(" | ");
}
