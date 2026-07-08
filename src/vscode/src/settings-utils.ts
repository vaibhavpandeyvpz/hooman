import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { resolveHoomanLaunch } from "./cli-launch";
import type {
  ConfigEditorStateInfo,
  ConfigLlmEntryState,
  ConfigProviderEntryState,
  McpAuthStatus,
  McpEditorStateInfo,
  McpServerEntryState,
  McpTransportType,
  OpenAIApi,
  PromptToggleKey,
  ProviderKind,
  SearchProvider,
  ToolToggleKey,
  TypedFieldDefinition,
} from "./shared/settings";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  LLM_FIELD_DEFINITIONS,
  MCP_REMOTE_BASE_FIELDS,
  MCP_REMOTE_OAUTH_FIELDS,
  MCP_STDIO_FIELDS,
  PROMPT_LABELS,
  PROVIDER_FIELD_DEFINITIONS,
  SEARCH_PROVIDER_LABELS,
  SUPPORTED_PROVIDER_TYPES,
  formatTransportSummary,
} from "./shared/settings";

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;

type NamedProviderEntry = {
  name: string;
  provider: ProviderKind;
  options: JsonObject;
};

type NamedLlmEntry = {
  name: string;
  provider: string;
  options: {
    model: string;
    temperature?: number;
    maxTokens?: number;
    context?: number;
    [key: string]: unknown;
  };
  billing?: unknown;
  default: boolean;
};

type ConfigJson = JsonObject & {
  name?: string;
  providers?: NamedProviderEntry[];
  llms?: NamedLlmEntry[];
  search?: JsonObject;
  prompts?: JsonObject;
  tools?: JsonObject;
  compaction?: JsonObject;
  reasoning?: "collapsed" | "full";
};

type McpTransport =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type: "streamable-http" | "sse";
      url: string;
      headers?: Record<string, string>;
      oauth?: {
        enabled?: boolean;
        clientId?: string;
        clientSecret?: string;
        authorizationUrl?: string;
        tokenUrl?: string;
        issuer?: string;
        registrationUrl?: string;
        scopes?: string[];
        audiences?: string[];
        redirectUri?: string;
        callbackPort?: number;
        tokenParamName?: string;
        clientMetadataUrl?: string;
      };
    };

type McpJson = { mcpServers?: Record<string, McpTransport> };

type StoredMcpOAuthEntry = {
  serverName: string;
  serverUrl: string;
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
    tokenType?: string;
  };
  updatedAt: number;
};

type StoredMcpOAuthFile = { entries?: Record<string, StoredMcpOAuthEntry> };

const DEFAULT_PROMPTS: Record<PromptToggleKey, boolean> = {
  behaviour: true,
  communication: true,
  execution: true,
  guardrails: true,
};

const DEFAULT_TOOLS: Record<ToolToggleKey, boolean> = {
  todo: true,
  fetch: true,
  filesystem: true,
  shell: true,
  sleep: true,
  subagents: true,
};

const DEFAULT_SEARCH = {
  enabled: false,
  provider: "brave" as SearchProvider,
  brave: { apiKey: undefined as string | undefined },
  exa: { apiKey: undefined as string | undefined },
  firecrawl: { apiKey: undefined as string | undefined },
  litellm: {
    apiKey: undefined as string | undefined,
    baseURL: undefined as string | undefined,
    tool: undefined as string | undefined,
  },
  serper: { apiKey: undefined as string | undefined },
  tavily: { apiKey: undefined as string | undefined },
};

const DEFAULT_HOME_CONFIG: ConfigJson = {
  name: "Hooman",
  providers: [
    { name: "llama.cpp", provider: "llama-cpp", options: {} },
    { name: "mlx", provider: "mlx", options: { promptCache: {} } },
  ],
  llms: [
    {
      name: "Gemma 4 E2B (llama.cpp)",
      provider: "llama.cpp",
      options: {
        model: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",
        context: 131072,
      },
      default: false,
    },
    {
      name: "Qwen3.5 2B (llama.cpp)",
      provider: "llama.cpp",
      options: {
        model: "unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M",
        context: 262144,
      },
      default: false,
    },
    {
      name: "Gemma 4 E2B (MLX)",
      provider: "mlx",
      options: {
        model: "mlx-community/gemma-4-e2b-it-OptiQ-4bit",
        context: 131072,
      },
      default: false,
    },
    {
      name: "Qwen3.5 2B (MLX)",
      provider: "mlx",
      options: {
        model: "mlx-community/Qwen3.5-2B-OptiQ-4bit",
        context: 262144,
      },
      default: false,
    },
  ],
  search: structuredClone(DEFAULT_SEARCH),
  prompts: { ...DEFAULT_PROMPTS },
  tools: {
    todo: { enabled: true },
    fetch: { enabled: true },
    filesystem: { enabled: true },
    shell: { enabled: true },
    sleep: { enabled: true },
    subagents: { enabled: true },
  },
  compaction: { ratio: 0.75, keep: 5 },
  reasoning: "collapsed",
};

function hoomanHomePath(): string {
  const override = process.env.HOOMAN_HOME?.trim();
  return override || join(homedir(), ".hooman");
}

export function homeConfigPath(): string {
  return join(hoomanHomePath(), "config.json");
}

export function homeMcpPath(): string {
  return join(hoomanHomePath(), "mcp.json");
}

export function homeInstructionsPath(): string {
  return join(hoomanHomePath(), "instructions.md");
}

export function homeSkillsPath(): string {
  return join(hoomanHomePath(), "skills");
}

export function isHoomanConfigPath(path: string): boolean {
  return (
    basename(path) === "config.json" && basename(dirname(path)) === ".hooman"
  );
}

export function isHoomanMcpPath(path: string): boolean {
  return basename(path) === "mcp.json" && basename(dirname(path)) === ".hooman";
}

export function scopeForPath(path: string): "global" | "project" {
  return resolve(path).startsWith(resolve(hoomanHomePath()))
    ? "global"
    : "project";
}

export function defaultConfigScaffold(isGlobal: boolean): string {
  return `${JSON.stringify(isGlobal ? DEFAULT_HOME_CONFIG : {}, null, 2)}\n`;
}

export function defaultMcpScaffold(): string {
  return '{\n  "mcpServers": {}\n}\n';
}

function parseJsonObject(text: string, label: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed as JsonObject;
  } catch (error) {
    throw new Error(
      `${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : undefined;
}

function parseNumber(
  input: string,
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }
  if (options.integer && !Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`${label} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${label} must be at most ${options.max}.`);
  }
  return parsed;
}

function parseOptionalNumber(
  input: string,
  label: string,
  options: { min?: number; integer?: boolean } = {},
): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  return parseNumber(trimmed, label, options);
}

function parseOptionalBoolean(
  input: string,
  label: string,
): boolean | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (["true", "yes", "y", "1", "on"].includes(trimmed)) {
    return true;
  }
  if (["false", "no", "n", "0", "off"].includes(trimmed)) {
    return false;
  }
  throw new Error(`${label} must be yes or no.`);
}

function parseStringArray(input: string, label: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== "string")
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a JSON array of strings.`);
  }
}

function parseStringRecord(
  input: string,
  label: string,
): Record<string, string> | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    for (const value of Object.values(parsed)) {
      if (typeof value !== "string") {
        throw new Error();
      }
    }
    return parsed as Record<string, string>;
  } catch {
    throw new Error(`${label} must be a JSON object with string values.`);
  }
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function truncate(value: string, max: number): string {
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function getConfigDoc(text: string): ConfigJson {
  return parseJsonObject(text, "config.json") as ConfigJson;
}

function getMcpDoc(text: string): McpJson {
  const parsed = parseJsonObject(text, "mcp.json") as McpJson;
  return {
    ...parsed,
    mcpServers:
      parsed.mcpServers &&
      typeof parsed.mcpServers === "object" &&
      !Array.isArray(parsed.mcpServers)
        ? parsed.mcpServers
        : {},
  };
}

function configProviders(doc: ConfigJson): NamedProviderEntry[] {
  return ensureArray<NamedProviderEntry>(doc.providers).filter(
    (entry) =>
      entry &&
      typeof entry.name === "string" &&
      typeof entry.provider === "string" &&
      entry.options &&
      typeof entry.options === "object" &&
      !Array.isArray(entry.options),
  );
}

function configLlms(doc: ConfigJson): NamedLlmEntry[] {
  return ensureArray<NamedLlmEntry>(doc.llms).filter(
    (entry) =>
      entry &&
      typeof entry.name === "string" &&
      typeof entry.provider === "string" &&
      entry.options &&
      typeof entry.options === "object" &&
      !Array.isArray(entry.options) &&
      typeof entry.options.model === "string",
  );
}

function configProviderUsageCount(
  doc: ConfigJson,
  providerName: string,
): number {
  return configLlms(doc).filter((llm) => llm.provider === providerName).length;
}

function providerOptionValue(
  definition: TypedFieldDefinition,
  options: JsonObject,
): unknown {
  if (definition.kind === "reasoningEffort") {
    return (options.reasoning as JsonObject | undefined)?.effort;
  }
  if (definition.kind === "reasoningSummary") {
    return (options.reasoning as JsonObject | undefined)?.summary;
  }
  if (definition.kind === "reasoningDisplay") {
    return (options.reasoning as JsonObject | undefined)?.display;
  }
  if (definition.kind === "openaiApi") {
    return options.api;
  }
  return options[definition.key];
}

function providerFieldMap(entry: NamedProviderEntry): Record<string, string> {
  const options = entry.options ?? {};
  const fields: Record<string, string> = { name: entry.name };
  for (const definition of PROVIDER_FIELD_DEFINITIONS[entry.provider] ?? []) {
    if (definition.kind === "bedrockCredentials") {
      fields.accessKeyId =
        typeof options.accessKeyId === "string" ? options.accessKeyId : "";
      fields.secretAccessKey =
        typeof options.secretAccessKey === "string"
          ? options.secretAccessKey
          : "";
      fields.credentials = fields.accessKeyId;
      continue;
    }
    if (definition.kind === "stringRecord") {
      fields[definition.key] =
        options[definition.key] && typeof options[definition.key] === "object"
          ? compactJson(options[definition.key])
          : "";
      continue;
    }
    if (definition.kind === "promptCache") {
      const promptCache = options.promptCache;
      fields.promptCache =
        promptCache === false || promptCache === null
          ? "no"
          : promptCache
            ? "yes"
            : "";
      const pool =
        promptCache &&
        typeof promptCache === "object" &&
        !Array.isArray(promptCache)
          ? (promptCache as JsonObject)
          : {};
      fields.promptCacheMaxEntries =
        pool.maxEntries === undefined ? "" : String(pool.maxEntries);
      fields.promptCacheTtl = pool.ttl === undefined ? "" : String(pool.ttl);
      fields.promptCacheMinTokens =
        pool.minTokens === undefined ? "" : String(pool.minTokens);
      continue;
    }
    const value = providerOptionValue(definition, options);
    fields[definition.key] = value === undefined ? "" : String(value);
  }
  return fields;
}

function llmFieldMap(entry: NamedLlmEntry): Record<string, string> {
  return {
    name: entry.name,
    provider: entry.provider,
    model: entry.options.model,
    temperature:
      entry.options.temperature === undefined
        ? ""
        : String(entry.options.temperature),
    maxTokens:
      entry.options.maxTokens === undefined
        ? ""
        : String(entry.options.maxTokens),
    context:
      entry.options.context === undefined ? "" : String(entry.options.context),
  };
}

function configStateFromDoc(
  path: string,
  doc: ConfigJson,
): ConfigEditorStateInfo {
  const prompts = {
    behaviour:
      typeof doc.prompts?.behaviour === "boolean"
        ? (doc.prompts.behaviour as boolean)
        : DEFAULT_PROMPTS.behaviour,
    communication:
      typeof doc.prompts?.communication === "boolean"
        ? (doc.prompts.communication as boolean)
        : DEFAULT_PROMPTS.communication,
    execution:
      typeof doc.prompts?.execution === "boolean"
        ? (doc.prompts.execution as boolean)
        : DEFAULT_PROMPTS.execution,
    guardrails:
      typeof doc.prompts?.guardrails === "boolean"
        ? (doc.prompts.guardrails as boolean)
        : DEFAULT_PROMPTS.guardrails,
  };
  const tools = {
    todo:
      typeof (doc.tools?.todo as JsonObject | undefined)?.enabled === "boolean"
        ? Boolean((doc.tools?.todo as JsonObject).enabled)
        : DEFAULT_TOOLS.todo,
    fetch:
      typeof (doc.tools?.fetch as JsonObject | undefined)?.enabled === "boolean"
        ? Boolean((doc.tools?.fetch as JsonObject).enabled)
        : DEFAULT_TOOLS.fetch,
    filesystem:
      typeof (doc.tools?.filesystem as JsonObject | undefined)?.enabled ===
      "boolean"
        ? Boolean((doc.tools?.filesystem as JsonObject).enabled)
        : DEFAULT_TOOLS.filesystem,
    shell:
      typeof (doc.tools?.shell as JsonObject | undefined)?.enabled === "boolean"
        ? Boolean((doc.tools?.shell as JsonObject).enabled)
        : DEFAULT_TOOLS.shell,
    sleep:
      typeof (doc.tools?.sleep as JsonObject | undefined)?.enabled === "boolean"
        ? Boolean((doc.tools?.sleep as JsonObject).enabled)
        : DEFAULT_TOOLS.sleep,
    subagents:
      typeof (doc.tools?.subagents as JsonObject | undefined)?.enabled ===
      "boolean"
        ? Boolean((doc.tools?.subagents as JsonObject).enabled)
        : DEFAULT_TOOLS.subagents,
  };
  const search = {
    enabled:
      typeof doc.search?.enabled === "boolean"
        ? Boolean(doc.search.enabled)
        : DEFAULT_SEARCH.enabled,
    provider:
      typeof doc.search?.provider === "string" &&
      Object.prototype.hasOwnProperty.call(
        SEARCH_PROVIDER_LABELS,
        doc.search.provider,
      )
        ? (doc.search.provider as SearchProvider)
        : DEFAULT_SEARCH.provider,
    brave: {
      apiKey: normalizeOptional(
        String((doc.search?.brave as JsonObject | undefined)?.apiKey ?? ""),
      ),
    },
    exa: {
      apiKey: normalizeOptional(
        String((doc.search?.exa as JsonObject | undefined)?.apiKey ?? ""),
      ),
    },
    firecrawl: {
      apiKey: normalizeOptional(
        String((doc.search?.firecrawl as JsonObject | undefined)?.apiKey ?? ""),
      ),
    },
    litellm: {
      apiKey: normalizeOptional(
        String((doc.search?.litellm as JsonObject | undefined)?.apiKey ?? ""),
      ),
      baseURL: normalizeOptional(
        String((doc.search?.litellm as JsonObject | undefined)?.baseURL ?? ""),
      ),
      tool: normalizeOptional(
        String((doc.search?.litellm as JsonObject | undefined)?.tool ?? ""),
      ),
    },
    serper: {
      apiKey: normalizeOptional(
        String((doc.search?.serper as JsonObject | undefined)?.apiKey ?? ""),
      ),
    },
    tavily: {
      apiKey: normalizeOptional(
        String((doc.search?.tavily as JsonObject | undefined)?.apiKey ?? ""),
      ),
    },
  };
  const providers = configProviders(doc).map(
    (provider): ConfigProviderEntryState => ({
      name: provider.name,
      provider: provider.provider,
      options: structuredClone(provider.options ?? {}),
      fields: providerFieldMap(provider),
      usageCount: configProviderUsageCount(doc, provider.name),
    }),
  );
  const llms = configLlms(doc).map((llm): ConfigLlmEntryState => ({
    name: llm.name,
    provider: llm.provider,
    options: {
      model: llm.options.model,
      temperature:
        typeof llm.options.temperature === "number"
          ? llm.options.temperature
          : undefined,
      maxTokens:
        typeof llm.options.maxTokens === "number"
          ? llm.options.maxTokens
          : undefined,
      context:
        typeof llm.options.context === "number"
          ? llm.options.context
          : undefined,
    },
    fields: llmFieldMap(llm),
    default: llm.default === true,
  }));
  return {
    path,
    name: basename(path),
    dirty: false,
    scope: scopeForPath(path),
    relatedGlobalPath:
      scopeForPath(path) === "project" ? homeConfigPath() : undefined,
    appName:
      typeof doc.name === "string" && doc.name.trim()
        ? doc.name.trim()
        : DEFAULT_HOME_CONFIG.name!,
    reasoning: doc.reasoning === "full" ? "full" : "collapsed",
    compaction: {
      ratio:
        typeof doc.compaction?.ratio === "number"
          ? Number(doc.compaction.ratio)
          : Number((DEFAULT_HOME_CONFIG.compaction as JsonObject).ratio),
      keep:
        typeof doc.compaction?.keep === "number"
          ? Number(doc.compaction.keep)
          : Number((DEFAULT_HOME_CONFIG.compaction as JsonObject).keep),
    },
    prompts,
    tools,
    search,
    providers,
    llms,
  };
}

export function loadConfigState(
  path: string,
  text: string,
): ConfigEditorStateInfo {
  return configStateFromDoc(path, getConfigDoc(text));
}

function updateConfigText(
  text: string,
  updater: (doc: ConfigJson) => void,
): string {
  const doc = getConfigDoc(text);
  updater(doc);
  return stringifyJson(doc);
}

export function saveConfigGeneral(
  text: string,
  updates: {
    appName: string;
    reasoning: "collapsed" | "full";
    compactionRatio: string;
    compactionKeep: string;
  },
): string {
  const name = updates.appName.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  return updateConfigText(text, (doc) => {
    doc.name = name;
    doc.reasoning = updates.reasoning;
    doc.compaction = {
      ...(doc.compaction ?? {}),
      ratio: parseNumber(updates.compactionRatio, "Compaction ratio", {
        min: 0,
        max: 1,
      }),
      keep: parseNumber(updates.compactionKeep, "Compaction keep", {
        min: 0,
        integer: true,
      }),
    };
  });
}

export function saveConfigPromptToggle(
  text: string,
  key: PromptToggleKey,
  value: boolean,
): string {
  return updateConfigText(text, (doc) => {
    doc.prompts = { ...(doc.prompts ?? {}), [key]: value };
  });
}

export function saveConfigToolToggle(
  text: string,
  key: ToolToggleKey,
  value: boolean,
): string {
  return updateConfigText(text, (doc) => {
    const tools = { ...(doc.tools ?? {}) };
    tools[key] = { enabled: value };
    doc.tools = tools;
  });
}

export function saveConfigSearch(
  text: string,
  updates: {
    enabled: boolean;
    provider: SearchProvider;
    apiKey: string;
    baseURL?: string;
    tool?: string;
  },
): string {
  const apiKey = updates.apiKey.trim();
  if (!apiKey) {
    throw new Error(
      `${updates.provider === "litellm" ? "Virtual key" : "API key"} is required.`,
    );
  }
  return updateConfigText(text, (doc) => {
    const search = { ...(doc.search ?? {}) };
    search.enabled = updates.enabled;
    search.provider = updates.provider;
    search[updates.provider] = {
      ...((search[updates.provider] as JsonObject | undefined) ?? {}),
      apiKey,
      ...(updates.provider === "litellm"
        ? {
            baseURL: normalizeOptional(updates.baseURL),
            tool: normalizeOptional(updates.tool),
          }
        : {}),
    };
    doc.search = search;
  });
}

function mergeReasoning(options: JsonObject): void {
  const reasoning = options.reasoning as JsonObject | undefined;
  if (!reasoning) {
    return;
  }
  if (!Object.values(reasoning).some((value) => value !== undefined)) {
    delete options.reasoning;
  }
}

function applyProviderFields(
  providerType: ProviderKind,
  base: JsonObject,
  fields: Record<string, string>,
): JsonObject {
  const options: JsonObject = { ...base };
  for (const definition of PROVIDER_FIELD_DEFINITIONS[providerType] ?? []) {
    const raw = fields[definition.key] ?? "";
    switch (definition.kind) {
      case "string": {
        const value = normalizeOptional(raw);
        if (value === undefined) {
          delete options[definition.key];
        } else {
          options[definition.key] = value;
        }
        break;
      }
      case "optionalBoolean": {
        const value = parseOptionalBoolean(raw, definition.label);
        if (value === undefined) {
          delete options[definition.key];
        } else {
          options[definition.key] = value;
        }
        break;
      }
      case "optionalInteger": {
        const value = parseOptionalNumber(raw, definition.label, {
          integer: true,
          min: 0,
        });
        if (value === undefined) {
          delete options[definition.key];
        } else {
          options[definition.key] = value;
        }
        break;
      }
      case "optionalNumber": {
        const value = parseOptionalNumber(raw, definition.label);
        if (value === undefined) {
          delete options[definition.key];
        } else {
          options[definition.key] = value;
        }
        break;
      }
      case "stringRecord": {
        const value = parseStringRecord(raw, definition.label);
        if (value === undefined) {
          delete options[definition.key];
        } else {
          options[definition.key] = value;
        }
        break;
      }
      case "openaiApi": {
        const value = normalizeOptional(raw) as OpenAIApi | undefined;
        if (value === undefined) {
          delete options.api;
        } else {
          options.api = value;
        }
        break;
      }
      case "reasoningEffort": {
        const value = normalizeOptional(raw);
        const reasoning = {
          ...((options.reasoning as JsonObject | undefined) ?? {}),
          effort: value,
        };
        options.reasoning = reasoning;
        break;
      }
      case "reasoningSummary": {
        const value = normalizeOptional(raw);
        const reasoning = {
          ...((options.reasoning as JsonObject | undefined) ?? {}),
          summary: value,
        };
        options.reasoning = reasoning;
        break;
      }
      case "reasoningDisplay": {
        const value = normalizeOptional(raw);
        const reasoning = {
          ...((options.reasoning as JsonObject | undefined) ?? {}),
          display: value,
        };
        options.reasoning = reasoning;
        break;
      }
      case "bedrockCredentials": {
        const accessKeyId = normalizeOptional(fields.accessKeyId);
        const secretAccessKey = normalizeOptional(fields.secretAccessKey);
        if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
          throw new Error(
            "Access key ID and secret access key must be provided together.",
          );
        }
        if (accessKeyId === undefined) {
          delete options.accessKeyId;
          delete options.secretAccessKey;
        } else {
          options.accessKeyId = accessKeyId;
          options.secretAccessKey = secretAccessKey;
        }
        break;
      }
      case "promptCache": {
        if (providerType === "mlx") {
          const enabled = parseOptionalBoolean(raw, definition.label);
          const maxEntries = parseOptionalNumber(
            fields.promptCacheMaxEntries ?? "",
            "Max entries",
            {
              integer: true,
              min: 1,
            },
          );
          const ttl = parseOptionalNumber(fields.promptCacheTtl ?? "", "TTL", {
            integer: true,
            min: 1,
          });
          const minTokens = parseOptionalNumber(
            fields.promptCacheMinTokens ?? "",
            "Min cacheable tokens",
            { integer: true, min: 0 },
          );
          if (enabled === false) {
            options.promptCache = false;
          } else if (
            enabled === true ||
            maxEntries !== undefined ||
            ttl !== undefined ||
            minTokens !== undefined
          ) {
            const next: JsonObject = {};
            if (maxEntries !== undefined) {
              next.maxEntries = maxEntries;
            }
            if (ttl !== undefined) {
              next.ttl = ttl;
            }
            if (minTokens !== undefined) {
              next.minTokens = minTokens;
            }
            options.promptCache = next;
          } else {
            delete options.promptCache;
          }
        } else {
          const value = parseOptionalBoolean(raw, definition.label);
          if (value === undefined) {
            delete options.promptCache;
          } else {
            options.promptCache = value;
          }
        }
        break;
      }
      default:
        break;
    }
  }
  mergeReasoning(options);
  return options;
}

export function saveConfigProvider(
  text: string,
  originalName: string | undefined,
  providerType: ProviderKind,
  fields: Record<string, string>,
): string {
  const name = (fields.name ?? "").trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  return updateConfigText(text, (doc) => {
    const providers = configProviders(doc);
    const existing = originalName
      ? providers.find((entry) => entry.name === originalName)
      : undefined;
    if (!originalName && providers.some((entry) => entry.name === name)) {
      throw new Error(`A provider named "${name}" already exists.`);
    }
    if (
      originalName &&
      originalName !== name &&
      providers.some((entry) => entry.name === name)
    ) {
      throw new Error(`A provider named "${name}" already exists.`);
    }
    const nextEntry: NamedProviderEntry = {
      name,
      provider: providerType,
      options: applyProviderFields(
        providerType,
        existing?.options ?? {},
        fields,
      ),
    };
    doc.providers = originalName
      ? providers.map((entry) =>
          entry.name === originalName ? nextEntry : entry,
        )
      : [...providers, nextEntry];
    if (originalName && originalName !== name) {
      doc.llms = configLlms(doc).map((llm) =>
        llm.provider === originalName ? { ...llm, provider: name } : llm,
      );
    }
  });
}

export function deleteConfigProvider(text: string, name: string): string {
  return updateConfigText(text, (doc) => {
    if (configLlms(doc).some((llm) => llm.provider === name)) {
      throw new Error(`Provider "${name}" is still used by one or more LLMs.`);
    }
    doc.providers = configProviders(doc).filter((entry) => entry.name !== name);
  });
}

export function saveConfigLlm(
  text: string,
  originalName: string | undefined,
  fields: Record<string, string>,
): string {
  const name = (fields.name ?? "").trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  const provider = (fields.provider ?? "").trim();
  if (!provider) {
    throw new Error("Provider is required.");
  }
  const model = (fields.model ?? "").trim();
  if (!model) {
    throw new Error("Model is required.");
  }
  return updateConfigText(text, (doc) => {
    const providers = configProviders(doc);
    if (!providers.some((entry) => entry.name === provider)) {
      throw new Error(`Provider "${provider}" does not exist in this file.`);
    }
    const llms = configLlms(doc);
    const existing = originalName
      ? llms.find((entry) => entry.name === originalName)
      : undefined;
    if (!originalName && llms.some((entry) => entry.name === name)) {
      throw new Error(`An LLM named "${name}" already exists.`);
    }
    if (
      originalName &&
      originalName !== name &&
      llms.some((entry) => entry.name === name)
    ) {
      throw new Error(`An LLM named "${name}" already exists.`);
    }
    const nextOptions = {
      ...(existing?.options ?? {}),
      model,
      temperature: parseOptionalNumber(fields.temperature ?? "", "Temperature"),
      maxTokens: parseOptionalNumber(fields.maxTokens ?? "", "Max tokens", {
        integer: true,
        min: 0,
      }),
      context: parseOptionalNumber(fields.context ?? "", "Context size", {
        integer: true,
        min: 0,
      }),
    } as NamedLlmEntry["options"];
    if (nextOptions.temperature === undefined) {
      delete nextOptions.temperature;
    }
    if (nextOptions.maxTokens === undefined) {
      delete nextOptions.maxTokens;
    }
    if (nextOptions.context === undefined) {
      delete nextOptions.context;
    }
    const nextEntry: NamedLlmEntry = {
      name,
      provider,
      options: nextOptions,
      billing: existing?.billing,
      default: existing?.default === true,
    };
    doc.llms = originalName
      ? llms.map((entry) => (entry.name === originalName ? nextEntry : entry))
      : [...llms, nextEntry];
  });
}

export function deleteConfigLlm(text: string, name: string): string {
  return updateConfigText(text, (doc) => {
    const llms = configLlms(doc);
    const current = llms.find((entry) => entry.name === name);
    if (!current) {
      throw new Error(`LLM "${name}" does not exist.`);
    }
    if (current.default) {
      throw new Error("Set another LLM as default before deleting this one.");
    }
    if (llms.length <= 1) {
      throw new Error("The only configured LLM cannot be deleted.");
    }
    doc.llms = llms.filter((entry) => entry.name !== name);
  });
}

export function setDefaultConfigLlm(text: string, name: string): string {
  return updateConfigText(text, (doc) => {
    doc.llms = configLlms(doc).map((entry) => ({
      ...entry,
      default: entry.name === name,
    }));
  });
}

function inferMcpTransport(value: unknown): McpTransport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as JsonObject;
  const type =
    typeof record.type === "string"
      ? record.type
      : typeof record.command === "string"
        ? "stdio"
        : typeof record.url === "string"
          ? "streamable-http"
          : undefined;
  if (type === "stdio" && typeof record.command === "string") {
    return {
      type: "stdio",
      command: record.command,
      args: Array.isArray(record.args)
        ? record.args.filter((item): item is string => typeof item === "string")
        : undefined,
      env:
        record.env &&
        typeof record.env === "object" &&
        !Array.isArray(record.env)
          ? Object.fromEntries(
              Object.entries(record.env).filter(
                ([, v]) => typeof v === "string",
              ) as Array<[string, string]>,
            )
          : undefined,
      cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    };
  }
  if (
    (type === "streamable-http" || type === "sse") &&
    typeof record.url === "string"
  ) {
    const oauth =
      record.oauth &&
      typeof record.oauth === "object" &&
      !Array.isArray(record.oauth)
        ? (record.oauth as McpTransport extends { oauth?: infer T } ? T : never)
        : undefined;
    return {
      type,
      url: record.url,
      headers:
        record.headers &&
        typeof record.headers === "object" &&
        !Array.isArray(record.headers)
          ? Object.fromEntries(
              Object.entries(record.headers).filter(
                ([, v]) => typeof v === "string",
              ) as Array<[string, string]>,
            )
          : undefined,
      oauth,
    };
  }
  return null;
}

function mcpServers(doc: McpJson): Record<string, McpTransport> {
  const result: Record<string, McpTransport> = {};
  for (const [name, value] of Object.entries(doc.mcpServers ?? {})) {
    const transport = inferMcpTransport(value);
    if (transport) {
      result[name] = transport;
    }
  }
  return result;
}

function canonicalizeRemoteServerUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  }
  return url.toString();
}

function remoteTransportFingerprint(
  name: string,
  transport: McpTransport,
): string | null {
  if (transport.type === "stdio") {
    return null;
  }
  const payload = JSON.stringify({
    name,
    type: transport.type,
    url: canonicalizeRemoteServerUrl(transport.url),
  });
  return createHash("sha256").update(payload).digest("hex");
}

function readStoredOAuthFile(): StoredMcpOAuthFile {
  const path = join(hoomanHomePath(), "mcp-oauth.json");
  if (!existsSync(path)) {
    return { entries: {} };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as StoredMcpOAuthFile;
    return {
      entries:
        parsed.entries && typeof parsed.entries === "object"
          ? parsed.entries
          : {},
    };
  } catch {
    return { entries: {} };
  }
}

function writeStoredOAuthFile(data: StoredMcpOAuthFile): void {
  const path = join(hoomanHomePath(), "mcp-oauth.json");
  writeFileSync(path, stringifyJson({ entries: data.entries ?? {} }), "utf8");
}

function authStatusForServer(
  name: string,
  transport: McpTransport,
): McpAuthStatus {
  if (transport.type === "stdio" || !transport.oauth) {
    return "unsupported";
  }
  const key = remoteTransportFingerprint(name, transport);
  if (!key) {
    return "unsupported";
  }
  const entry = readStoredOAuthFile().entries?.[key];
  if (!entry?.tokens?.accessToken) {
    return "unauthenticated";
  }
  if (
    typeof entry.tokens.expiresAt === "number" &&
    Number.isFinite(entry.tokens.expiresAt) &&
    entry.tokens.expiresAt <= Date.now() &&
    !entry.tokens.refreshToken
  ) {
    return "expired";
  }
  return "authenticated";
}

function relatedProjectHoomanPath(filename: string): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return folder ? join(folder, ".hooman", filename) : undefined;
}

function mcpFieldMap(
  name: string,
  transport: McpTransport,
): Record<string, string> {
  if (transport.type === "stdio") {
    return {
      name,
      command: transport.command,
      args: JSON.stringify(transport.args ?? []),
      env: transport.env ? JSON.stringify(transport.env) : "",
      cwd: transport.cwd ?? "",
    };
  }
  return {
    name,
    url: transport.url,
    headers: transport.headers ? JSON.stringify(transport.headers) : "",
    oauthEnabled: transport.oauth ? "yes" : "no",
    clientId: transport.oauth?.clientId ?? "",
    clientSecret: transport.oauth?.clientSecret ?? "",
    scopes: transport.oauth?.scopes
      ? JSON.stringify(transport.oauth.scopes)
      : "",
    audiences: transport.oauth?.audiences
      ? JSON.stringify(transport.oauth.audiences)
      : "",
    callbackPort:
      transport.oauth?.callbackPort === undefined
        ? ""
        : String(transport.oauth.callbackPort),
    redirectUri: transport.oauth?.redirectUri ?? "",
    issuer: transport.oauth?.issuer ?? "",
    authorizationUrl: transport.oauth?.authorizationUrl ?? "",
    tokenUrl: transport.oauth?.tokenUrl ?? "",
    registrationUrl: transport.oauth?.registrationUrl ?? "",
    tokenParamName: transport.oauth?.tokenParamName ?? "",
  };
}

export function loadMcpState(path: string, text: string): McpEditorStateInfo {
  const doc = getMcpDoc(text);
  const currentPath = resolve(path);
  const globalPath = resolve(homeMcpPath());
  const relatedProjectPath = relatedProjectHoomanPath("mcp.json");
  const relatedPath =
    currentPath === globalPath ? relatedProjectPath : resolve(homeMcpPath());
  const relatedDoc =
    relatedPath && existsSync(relatedPath)
      ? getMcpDoc(readFileSync(relatedPath, "utf8"))
      : undefined;
  const currentServers = mcpServers(doc);
  const relatedServers = relatedDoc ? mcpServers(relatedDoc) : {};
  const servers: McpServerEntryState[] = Object.entries(currentServers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, transport]) => ({
      name,
      transportType: transport.type,
      summary: formatTransportSummary(
        transport as unknown as Record<string, unknown>,
      ),
      transport: transport as unknown as Record<string, unknown>,
      fields: mcpFieldMap(name, transport),
      authStatus: authStatusForServer(name, transport),
      shadows:
        relatedPath && relatedServers[name] && currentPath !== globalPath
          ? truncate(relatedPath, 90)
          : undefined,
      shadowedBy:
        relatedPath && relatedServers[name] && currentPath === globalPath
          ? truncate(relatedPath, 90)
          : undefined,
    }));
  return {
    path,
    name: basename(path),
    dirty: false,
    scope: scopeForPath(path),
    relatedGlobalPath: currentPath === globalPath ? undefined : homeMcpPath(),
    relatedProjectPath:
      currentPath === globalPath ? relatedProjectPath : undefined,
    servers,
  };
}

function updateMcpText(text: string, updater: (doc: McpJson) => void): string {
  const doc = getMcpDoc(text);
  updater(doc);
  return stringifyJson(doc);
}

export function saveMcpServer(
  text: string,
  originalName: string | undefined,
  transportType: McpTransportType,
  fields: Record<string, string>,
): string {
  const name = (fields.name ?? "").trim();
  if (!name) {
    throw new Error("Server name is required.");
  }
  return updateMcpText(text, (doc) => {
    const servers = { ...mcpServers(doc) };
    if (!originalName && servers[name]) {
      throw new Error(`MCP server "${name}" already exists.`);
    }
    if (originalName && originalName !== name && servers[name]) {
      throw new Error(`MCP server "${name}" already exists.`);
    }
    let transport: McpTransport;
    if (transportType === "stdio") {
      const command = (fields.command ?? "").trim();
      if (!command) {
        throw new Error("Command is required.");
      }
      transport = {
        type: "stdio",
        command,
        args: parseStringArray(fields.args ?? "", "Arguments"),
        env: parseStringRecord(fields.env ?? "", "Environment variables"),
        cwd: normalizeOptional(fields.cwd),
      };
    } else {
      const url = (fields.url ?? "").trim();
      if (!url) {
        throw new Error("URL is required.");
      }
      const oauthEnabled =
        parseOptionalBoolean(fields.oauthEnabled ?? "", "Enable OAuth") ===
        true;
      transport = {
        type: transportType,
        url,
        headers: parseStringRecord(fields.headers ?? "", "Headers"),
        oauth: oauthEnabled
          ? {
              enabled: true,
              clientId: normalizeOptional(fields.clientId),
              clientSecret: normalizeOptional(fields.clientSecret),
              authorizationUrl: normalizeOptional(fields.authorizationUrl),
              tokenUrl: normalizeOptional(fields.tokenUrl),
              issuer: normalizeOptional(fields.issuer),
              registrationUrl: normalizeOptional(fields.registrationUrl),
              scopes: parseStringArray(fields.scopes ?? "", "OAuth scopes"),
              audiences: parseStringArray(
                fields.audiences ?? "",
                "OAuth audiences",
              ),
              redirectUri: normalizeOptional(fields.redirectUri),
              callbackPort: parseOptionalNumber(
                fields.callbackPort ?? "",
                "OAuth callback port",
                {
                  integer: true,
                  min: 1,
                },
              ),
              tokenParamName: normalizeOptional(fields.tokenParamName),
            }
          : undefined,
      };
    }
    if (originalName && originalName !== name) {
      delete servers[originalName];
    }
    servers[name] = transport;
    doc.mcpServers = servers;
  });
}

export function deleteMcpServer(text: string, name: string): string {
  return updateMcpText(text, (doc) => {
    const servers = { ...mcpServers(doc) };
    if (!servers[name]) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    delete servers[name];
    doc.mcpServers = servers;
  });
}

export async function authenticateMcpServer(name: string): Promise<void> {
  const invocation = await resolveHoomanLaunch(["mcp", "auth", name]);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Hooman: authenticating MCP server “${name}”`,
      cancellable: false,
    },
    async () => {
      await execFileAsync(invocation.command, invocation.args, {
        env: invocation.env,
        maxBuffer: 10 * 1024 * 1024,
      });
    },
  );
}

export function logoutMcpServer(
  name: string,
  transport: Record<string, unknown>,
): void {
  if (
    (transport.type !== "streamable-http" && transport.type !== "sse") ||
    typeof transport.url !== "string"
  ) {
    return;
  }
  const key = remoteTransportFingerprint(name, transport as McpTransport);
  if (!key) {
    return;
  }
  const file = readStoredOAuthFile();
  if (file.entries && file.entries[key]) {
    delete file.entries[key];
    writeStoredOAuthFile(file);
  }
}

export async function openTextFile(path: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(path);
  return vscode.window.showTextDocument(document, { preview: false });
}

export function ensureFile(path: string, scaffold: string): void {
  if (!existsSync(path)) {
    vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(path))).then(
      () =>
        vscode.workspace.fs.writeFile(
          vscode.Uri.file(path),
          Buffer.from(scaffold, "utf8"),
        ),
      () => undefined,
    );
  }
}

export function providerFields(
  provider: ProviderKind,
): readonly TypedFieldDefinition[] {
  return PROVIDER_FIELD_DEFINITIONS[provider] ?? [];
}

export function llmFields(): readonly TypedFieldDefinition[] {
  return LLM_FIELD_DEFINITIONS;
}

export function mcpStdioFields() {
  return MCP_STDIO_FIELDS;
}

export function mcpRemoteFields() {
  return [...MCP_REMOTE_BASE_FIELDS, ...MCP_REMOTE_OAUTH_FIELDS];
}

export {
  DEFAULT_MODEL_BY_PROVIDER,
  PROMPT_LABELS,
  SEARCH_PROVIDER_LABELS,
  SUPPORTED_PROVIDER_TYPES,
  yesNo,
};
