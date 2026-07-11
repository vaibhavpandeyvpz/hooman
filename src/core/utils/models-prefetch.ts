/**
 * Prefetch model ids from provider-specific list endpoints (or curated
 * local defaults). Used by VS Code onboarding and available to other
 * surfaces that need a first-run / picker catalog without going through ACP.
 *
 * Flow: list from the provider → check models.dev → keep chat LLMs only
 * (display names from the catalog when present).
 */

import {
  ensureModelsDevCatalog,
  resolveModelsDevModelInfo,
} from "./metadata.js";

const MODEL_LIST_CAP = 40;
const FETCH_TIMEOUT_MS = 20_000;

/** Id patterns that are never chat LLMs when models.dev has no entry. */
const NON_LLM_ID_RE =
  /(embed|whisper|tts|stt|transcri|moderation|guard|imagine|kling|asr|realtime|dall-?e|imagen|gpt-image|chatgpt-image|omni-flash|-video\b|veo|lyria|deep-research|\baqa\b|native-audio|computer-use|robotics|-image(?:-|$)|nano-banana|antigravity)/i;

/** Runtime provider id (matches `LlmProvider` string values). */
export type PrefetchProviderId =
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

export type PrefetchedModel = {
  id: string;
  displayName: string;
};

export type PrefetchModelsOptions = {
  provider: PrefetchProviderId;
  apiKey?: string;
  baseURL?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Azure deployment name — used as the sole/default model id. */
  azureDeployment?: string;
  /** Prefer this model id (moved to front, or inserted when missing). */
  preferredModel?: string;
  /** Soft cap for huge catalogs (default 40). */
  limit?: number;
  signal?: AbortSignal;
};

/** Suggested default model id per provider (matches VS Code / configure UI). */
export const DEFAULT_PREFETCH_MODEL_BY_PROVIDER: Record<
  PrefetchProviderId,
  string
> = {
  anthropic: "claude-sonnet-4-6",
  azure: "gpt-5.4-mini",
  bedrock: "anthropic.claude-sonnet-4-6",
  google: "gemini-3.5-flash",
  groq: "openai/gpt-oss-20b",
  "llama-cpp": "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",
  minimax: "MiniMax-M3",
  mlx: "mlx-community/gemma-4-e2b-it-OptiQ-4bit",
  moonshot: "kimi-k2.7-code",
  ollama: "gemma4:e4b",
  openai: "gpt-5.5",
  openrouter: "google/gemma-4-26b-a4b-it:free",
  xai: "grok-4.3",
};

/**
 * Known-good model id/label for local / curated providers (llama.cpp, MLX, Bedrock).
 */
export function defaultPrefetchedModel(
  provider: PrefetchProviderId,
): PrefetchedModel {
  const id = DEFAULT_PREFETCH_MODEL_BY_PROVIDER[provider];
  const curated = CURATED_DISPLAY_NAMES[provider]?.[id];
  return { id, displayName: curated ?? humanizeModelId(id) };
}

/** Providers that need an API key (or Azure key + deployment) before onboarding can finish. */
export function providerRequiresCredentials(
  provider: PrefetchProviderId,
): boolean {
  switch (provider) {
    case "llama-cpp":
    case "mlx":
    case "ollama":
    case "bedrock":
      return false;
    default:
      return true;
  }
}

/**
 * Whether the options include the credentials needed to call the list endpoint.
 */
export function hasPrefetchCredentials(
  options: PrefetchModelsOptions,
): boolean {
  switch (options.provider) {
    case "llama-cpp":
    case "mlx":
    case "bedrock":
      return true;
    case "ollama":
      return true;
    case "azure":
      return Boolean(
        options.apiKey?.trim() &&
        options.baseURL?.trim() &&
        options.azureDeployment?.trim(),
      );
    case "anthropic":
    case "google":
    case "groq":
    case "minimax":
    case "moonshot":
    case "openai":
    case "openrouter":
    case "xai":
      return Boolean(options.apiKey?.trim());
    default: {
      const _exhaustive: never = options.provider;
      return _exhaustive;
    }
  }
}

/**
 * Resolve models for onboarding. Credentials required by the provider must be
 * present and valid (list endpoint succeeds); there is no silent fallback.
 * Local / curated providers (llama.cpp, MLX, Bedrock) use known defaults.
 */
export async function resolvePrefetchModels(
  options: PrefetchModelsOptions,
): Promise<PrefetchedModel[]> {
  switch (options.provider) {
    case "llama-cpp":
    case "mlx":
    case "bedrock":
      return prefetchProviderModels({
        ...options,
        preferredModel:
          options.preferredModel ??
          DEFAULT_PREFETCH_MODEL_BY_PROVIDER[options.provider],
        limit: 1,
      });
    case "ollama": {
      const models = await prefetchProviderModels(options);
      if (models.length === 0) {
        throw new Error(
          "Ollama returned no models. Pull a model or check the base URL.",
        );
      }
      return models;
    }
    case "azure": {
      if (!options.apiKey?.trim()) {
        throw new Error("API key is required.");
      }
      if (!options.baseURL?.trim()) {
        throw new Error("Base URL is required.");
      }
      if (!options.azureDeployment?.trim()) {
        throw new Error("Deployment name is required.");
      }
      return prefetchProviderModels(options);
    }
    default: {
      if (!options.apiKey?.trim()) {
        throw new Error("API key is required.");
      }
      const models = await prefetchProviderModels(options);
      if (models.length === 0) {
        throw new Error(
          "The provider returned no models — check that the API key is valid.",
        );
      }
      return models;
    }
  }
}

const CURATED_DISPLAY_NAMES: Partial<
  Record<PrefetchProviderId, Record<string, string>>
> = {
  "llama-cpp": {
    "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M": "Gemma 4 E2B (llama.cpp)",
  },
  mlx: {
    "mlx-community/gemma-4-e2b-it-OptiQ-4bit": "Gemma 4 E2B (MLX)",
  },
  bedrock: {
    "anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6",
  },
};

/**
 * List models for a provider: remote catalog where available, curated
 * local entries for llama.cpp / MLX, deployment name for Azure.
 * Non-LLM catalog entries are dropped; display names prefer models.dev.
 */
export async function prefetchProviderModels(
  options: PrefetchModelsOptions,
): Promise<PrefetchedModel[]> {
  const preferred =
    options.preferredModel?.trim() ||
    DEFAULT_PREFETCH_MODEL_BY_PROVIDER[options.provider];
  const limit = options.limit ?? MODEL_LIST_CAP;
  const { provider } = options;

  switch (provider) {
    case "llama-cpp":
      return finalizePrefetchModels(
        provider,
        [
          {
            id: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",
            displayName: "Gemma 4 E2B (llama.cpp)",
          },
          {
            id: "unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M",
            displayName: "Qwen3.5 2B (llama.cpp)",
          },
        ],
        preferred,
        limit,
      );
    case "mlx":
      return finalizePrefetchModels(
        provider,
        [
          {
            id: "mlx-community/gemma-4-e2b-it-OptiQ-4bit",
            displayName: "Gemma 4 E2B (MLX)",
          },
          {
            id: "mlx-community/Qwen3.5-2B-OptiQ-4bit",
            displayName: "Qwen3.5 2B (MLX)",
          },
        ],
        preferred,
        limit,
      );
    case "azure": {
      const deployment = (options.azureDeployment ?? "").trim();
      if (!deployment) {
        throw new Error("Deployment name is required for Azure.");
      }
      return finalizePrefetchModels(
        provider,
        [{ id: deployment, displayName: humanizeModelId(deployment) }],
        preferred,
        limit,
      );
    }
    case "ollama":
      return finalizePrefetchModels(
        provider,
        await listOllamaModels(options.baseURL?.trim(), options.signal),
        preferred,
        limit,
      );
    case "anthropic":
      return finalizePrefetchModels(
        provider,
        await listAnthropicModels(
          options.apiKey?.trim() ?? "",
          options.baseURL?.trim(),
          options.signal,
        ),
        preferred,
        limit,
      );
    case "google":
      return finalizePrefetchModels(
        provider,
        await listGoogleModels(options.apiKey?.trim() ?? "", options.signal),
        preferred,
        limit,
      );
    case "bedrock":
      return finalizePrefetchModels(
        provider,
        await listBedrockModels(
          options.region?.trim() ?? "us-west-2",
          options.accessKeyId?.trim() ?? "",
          options.secretAccessKey?.trim() ?? "",
        ),
        preferred,
        limit,
      );
    case "openai":
    case "groq":
    case "openrouter":
    case "xai":
    case "moonshot":
    case "minimax":
      return finalizePrefetchModels(
        provider,
        await listOpenAiCompatibleModels(
          provider,
          options.apiKey?.trim() ?? "",
          options.baseURL?.trim(),
          options.signal,
        ),
        preferred,
        limit,
      );
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

function modelsDevProviderHint(
  provider: PrefetchProviderId,
): string | undefined {
  switch (provider) {
    case "moonshot":
      return "moonshotai";
    case "bedrock":
      return "amazon-bedrock";
    case "llama-cpp":
    case "mlx":
    case "ollama":
      return undefined;
    default:
      return provider;
  }
}

function looksLikeNonLlmId(id: string): boolean {
  return NON_LLM_ID_RE.test(id);
}

/**
 * Filter a provider API model list through models.dev: keep entries the
 * catalog classifies as chat LLMs (and use its display names). Local /
 * deployment providers keep API rows that are not known non-LLMs when the
 * catalog has no match.
 */
async function finalizePrefetchModels(
  provider: PrefetchProviderId,
  models: PrefetchedModel[],
  preferred: string,
  limit: number,
): Promise<PrefetchedModel[]> {
  await ensureModelsDevCatalog();
  const hint = modelsDevProviderHint(provider);
  const requireCatalogLlm = requiresModelsDevLlmCheck(provider);
  const filtered: PrefetchedModel[] = [];

  for (const model of models) {
    const info = await resolveModelsDevModelInfo(model.id, hint, {
      exact: true,
    });
    if (info) {
      if (!info.isChatLlm) {
        continue;
      }
      filtered.push({ id: model.id, displayName: info.displayName });
      continue;
    }
    // Not on models.dev — hosted providers skip; local/azure may keep.
    if (requireCatalogLlm) {
      continue;
    }
    if (looksLikeNonLlmId(model.id)) {
      continue;
    }
    filtered.push(model);
  }

  const prioritized = prioritize(filtered, preferred, limit);
  // Re-check preferred inserts against models.dev for hosted providers.
  if (!requireCatalogLlm) {
    return prioritized;
  }
  const out: PrefetchedModel[] = [];
  for (const model of prioritized) {
    const info = await resolveModelsDevModelInfo(model.id, hint, {
      exact: true,
    });
    if (info?.isChatLlm) {
      out.push({ id: model.id, displayName: info.displayName });
    }
  }
  return out;
}

/** Hosted providers: only add models models.dev marks as chat LLMs. */
function requiresModelsDevLlmCheck(provider: PrefetchProviderId): boolean {
  switch (provider) {
    case "llama-cpp":
    case "mlx":
    case "ollama":
    case "azure":
      return false;
    default:
      return true;
  }
}

function prioritize(
  models: PrefetchedModel[],
  preferred: string,
  limit: number,
): PrefetchedModel[] {
  const unique = new Map<string, PrefetchedModel>();
  for (const model of models) {
    if (!unique.has(model.id)) {
      unique.set(model.id, model);
    }
  }
  const list = [...unique.values()];
  const preferredIndex = list.findIndex((m) => m.id === preferred);
  if (preferredIndex > 0) {
    const [hit] = list.splice(preferredIndex, 1);
    if (hit) {
      list.unshift(hit);
    }
  } else if (preferredIndex === -1 && preferred) {
    if (!looksLikeNonLlmId(preferred)) {
      list.unshift({ id: preferred, displayName: humanizeModelId(preferred) });
    }
  }
  return list.slice(0, limit);
}

function humanizeModelId(id: string): string {
  const leaf = id.includes("/") ? (id.split("/").pop() ?? id) : id;
  return leaf
    .replace(/[:_]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function listOpenAiCompatibleModels(
  provider: PrefetchProviderId,
  apiKey: string,
  baseURL: string | undefined,
  signal?: AbortSignal,
): Promise<PrefetchedModel[]> {
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  const base = (baseURL || defaultOpenAiBase(provider)).replace(/\/+$/, "");
  const url = `${base}/models`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://vaibhavpandey.com/hooman/";
    headers["X-Title"] = "Hooman";
  }
  const json = await fetchJson<{
    data?: Array<{ id?: string; name?: string }>;
  }>(url, { headers, signal });
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .map((row) => {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!id) {
        return null;
      }
      const displayName =
        typeof row.name === "string" && row.name.trim()
          ? row.name.trim()
          : humanizeModelId(id);
      return { id, displayName };
    })
    .filter((row): row is PrefetchedModel => row !== null);
}

function defaultOpenAiBase(provider: PrefetchProviderId): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "moonshot":
      return "https://api.moonshot.ai/v1";
    case "minimax":
      return "https://api.minimax.io/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

async function listOllamaModels(
  baseURL: string | undefined,
  signal?: AbortSignal,
): Promise<PrefetchedModel[]> {
  const host = (baseURL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const json = await fetchJson<{
    models?: Array<{ name?: string; model?: string }>;
  }>(`${host}/api/tags`, {
    headers: { Accept: "application/json" },
    signal,
  });
  const rows = Array.isArray(json.models) ? json.models : [];
  return rows
    .map((row) => {
      const id = (row.name ?? row.model ?? "").trim();
      if (!id) {
        return null;
      }
      return { id, displayName: humanizeModelId(id) };
    })
    .filter((row): row is PrefetchedModel => row !== null);
}

async function listAnthropicModels(
  apiKey: string,
  baseURL: string | undefined,
  signal?: AbortSignal,
): Promise<PrefetchedModel[]> {
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  const base = (baseURL || "https://api.anthropic.com").replace(/\/+$/, "");
  const json = await fetchJson<{
    data?: Array<{ id?: string; display_name?: string }>;
  }>(`${base}/v1/models`, {
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
  });
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .map((row) => {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!id) {
        return null;
      }
      const displayName =
        typeof row.display_name === "string" && row.display_name.trim()
          ? row.display_name.trim()
          : humanizeModelId(id);
      return { id, displayName };
    })
    .filter((row): row is PrefetchedModel => row !== null);
}

async function listGoogleModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<PrefetchedModel[]> {
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const json = await fetchJson<{
    models?: Array<{
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  }>(url, { headers: { Accept: "application/json" }, signal });
  const rows = Array.isArray(json.models) ? json.models : [];
  return rows
    .map((row) => {
      const raw = typeof row.name === "string" ? row.name.trim() : "";
      if (!raw) {
        return null;
      }
      const methods = Array.isArray(row.supportedGenerationMethods)
        ? row.supportedGenerationMethods
        : [];
      // Chat / agent use generateContent. Drop Veo (predictLongRunning),
      // AQA (generateAnswer), native-audio (bidiGenerateContent), etc.
      if (!methods.includes("generateContent")) {
        return null;
      }
      const id = raw.startsWith("models/") ? raw.slice("models/".length) : raw;
      const displayName =
        typeof row.displayName === "string" && row.displayName.trim()
          ? row.displayName.trim()
          : humanizeModelId(id);
      return { id, displayName };
    })
    .filter((row): row is PrefetchedModel => row !== null);
}

async function listBedrockModels(
  _region: string,
  _accessKeyId: string,
  _secretAccessKey: string,
): Promise<PrefetchedModel[]> {
  // Curated shortlist — ListFoundationModels needs SigV4; runtime uses
  // profile / default credential chain instead of listing via the API.
  return [
    {
      id: "anthropic.claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
    },
    {
      id: "anthropic.claude-haiku-4-5-20251001-v1:0",
      displayName: "Claude Haiku 4.5",
    },
    {
      id: "amazon.nova-pro-v1:0",
      displayName: "Amazon Nova Pro",
    },
    {
      id: "amazon.nova-lite-v1:0",
      displayName: "Amazon Nova Lite",
    },
  ];
}

async function fetchJson<T>(
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: init.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Model list failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}
