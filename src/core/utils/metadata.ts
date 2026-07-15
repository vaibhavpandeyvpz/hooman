import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cachePath } from "./paths.js";
import { LlmProvider } from "../models/types.js";
import type {
  LlamaCppProviderOptions,
  LlmInputModality,
  LlmMetadata,
  LlmOptions,
  MlxProviderOptions,
  ProviderOptions,
} from "../models/types.js";

/**
 * Model metadata resolution backed by the models.dev catalog.
 *
 * The catalog (`https://models.dev/catalog.json`) is cached on disk under
 * `~/.hooman/cache/models-dev.json` and refreshed at most once per day; a
 * stale copy is used when the refresh fails, so resolution keeps working
 * offline once the catalog has been fetched at least once.
 *
 * `catalog.providers` is keyed by provider id and carries per-provider model
 * entries with `limit.context`, `cost` (USD per million tokens), and optional
 * `modalities.input`; `catalog.models` is keyed by `lab/model-id` and
 * identifies each model's canonical lab. When several providers serve a
 * matching model, the provider whose id equals the lab (e.g. `anthropic` for
 * `anthropic/claude-*`) wins; otherwise the first matching provider's metrics
 * are used.
 */

const CATALOG_URL = "https://models.dev/catalog.json";
const CACHE_FILE = "models-dev.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
/** After a failed refresh, don't re-hit the network for this long (avoids repeated offline stalls). */
const FAILURE_RETRY_MS = 5 * 60 * 1000;

type ModelsDevModel = {
  id?: string;
  name?: string;
  family?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  limit?: { context?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
};

type ModelsDevCatalog = {
  models?: Record<string, unknown>;
  providers?: Record<string, { models?: Record<string, ModelsDevModel> }>;
};

type CacheEnvelope = {
  fetchedAt: string;
  catalog: ModelsDevCatalog;
};

/** Resolved per-million-token USD prices (cache tiers fall back to `inputPerM`). */
export type ResolvedMetadataCosts = {
  inputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  outputPerM: number;
};

export type ResolvedLlmModality = {
  text: boolean;
  image: boolean;
  pdf: boolean;
  audio: boolean;
  video: boolean;
};

/**
 * Model metadata for the active model, merged from the LLM config's
 * `metadata` block (which wins per field) and the models.dev catalog. Fields
 * that could not be resolved from either source stay `undefined` — consumers
 * must not report context usage without `context` or cost without `costs`.
 * Modality always resolves, defaulting to text-only when unset.
 */
export type ResolvedLlmMetadata = {
  name: string;
  context?: number;
  maxOutputTokens?: number;
  costs?: ResolvedMetadataCosts;
  modality: ResolvedLlmModality;
};

let memory: { envelope: CacheEnvelope; loadedAt: number } | null = null;
let inflight: Promise<ModelsDevCatalog | null> | null = null;
let lastFetchFailureAt = 0;

function cacheFilePath(): string {
  return join(cachePath(), CACHE_FILE);
}

function isFresh(envelope: CacheEnvelope): boolean {
  const fetchedAt = Date.parse(envelope.fetchedAt);
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < CACHE_TTL_MS;
}

async function readDiskCache(): Promise<CacheEnvelope | null> {
  try {
    const raw = await readFile(cacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope>;
    if (
      typeof parsed?.fetchedAt === "string" &&
      parsed.catalog &&
      typeof parsed.catalog === "object"
    ) {
      return parsed as CacheEnvelope;
    }
  } catch {
    /* missing or corrupt cache */
  }
  return null;
}

async function fetchCatalog(): Promise<CacheEnvelope> {
  const response = await fetch(CATALOG_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`models.dev responded with ${response.status}`);
  }
  const catalog = (await response.json()) as ModelsDevCatalog;
  return { fetchedAt: new Date().toISOString(), catalog };
}

async function writeDiskCache(envelope: CacheEnvelope): Promise<void> {
  try {
    await mkdir(cachePath(), { recursive: true });
    await writeFile(cacheFilePath(), JSON.stringify(envelope), "utf8");
  } catch {
    /* best effort */
  }
}

async function loadCatalog(): Promise<ModelsDevCatalog | null> {
  if (memory && isFresh(memory.envelope)) {
    return memory.envelope.catalog;
  }
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    const cached = memory?.envelope ?? (await readDiskCache());
    if (cached && isFresh(cached)) {
      memory = { envelope: cached, loadedAt: Date.now() };
      return cached.catalog;
    }
    if (Date.now() - lastFetchFailureAt < FAILURE_RETRY_MS) {
      if (cached) {
        memory = { envelope: cached, loadedAt: Date.now() };
        return cached.catalog;
      }
      return null;
    }
    try {
      const envelope = await fetchCatalog();
      memory = { envelope, loadedAt: Date.now() };
      await writeDiskCache(envelope);
      return envelope.catalog;
    } catch {
      lastFetchFailureAt = Date.now();
      if (cached) {
        memory = { envelope: cached, loadedAt: Date.now() };
        return cached.catalog;
      }
      return null;
    }
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

function normalizeModelId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function targetForms(name: string): string[] {
  const forms = new Set<string>();
  const normalized = normalizeModelId(name);
  if (normalized) {
    forms.add(normalized);
  }
  const tail = name.split("/").pop();
  if (tail) {
    const normalizedTail = normalizeModelId(tail);
    if (normalizedTail) {
      forms.add(normalizedTail);
    }
  }
  return [...forms];
}

function matchModelId(
  targets: readonly string[],
  candidateId: string,
): { tier: 1 | 2; lengthDiff: number } | null {
  const candidate = normalizeModelId(candidateId);
  if (!candidate) {
    return null;
  }
  let best: { tier: 1 | 2; lengthDiff: number } | null = null;
  for (const target of targets) {
    if (target === candidate) {
      return { tier: 1, lengthDiff: 0 };
    }
    const shorter = target.length < candidate.length ? target : candidate;
    const longer = target.length < candidate.length ? candidate : target;
    if (shorter.length >= 4 && longer.includes(shorter)) {
      const index = longer.indexOf(shorter);
      const before = index === 0 || longer[index - 1] === "-";
      const after =
        index + shorter.length === longer.length ||
        longer[index + shorter.length] === "-";
      if (before && after) {
        const lengthDiff = longer.length - shorter.length;
        if (!best || lengthDiff < best.lengthDiff) {
          best = { tier: 2, lengthDiff };
        }
      }
    }
  }
  return best;
}

type ProviderMatch = {
  providerId: string;
  model: ModelsDevModel;
  tier: 1 | 2;
  lengthDiff: number;
};

function catalogModalitiesToResolved(
  modalities?: ModelsDevModel["modalities"],
): ResolvedLlmModality {
  const inputs = new Set(
    (modalities?.input ?? []).map((value) => value.toLowerCase()),
  );
  return {
    text: inputs.size === 0 || inputs.has("text"),
    image: inputs.has("image"),
    pdf: inputs.has("pdf"),
    audio: inputs.has("audio"),
    video: inputs.has("video"),
  };
}

function mergeResolvedModality(
  configured?: LlmInputModality,
  resolved?: ResolvedLlmModality,
): ResolvedLlmModality {
  return {
    text: configured?.text ?? resolved?.text ?? true,
    image: configured?.image ?? resolved?.image ?? false,
    pdf: configured?.pdf ?? resolved?.pdf ?? false,
    audio: configured?.audio ?? resolved?.audio ?? false,
    video: configured?.video ?? resolved?.video ?? false,
  };
}

function catalogEntryToMetadata(
  model: ModelsDevModel,
): Pick<
  ResolvedLlmMetadata,
  "context" | "maxOutputTokens" | "costs" | "modality"
> {
  const context =
    typeof model.limit?.context === "number" && model.limit.context > 0
      ? model.limit.context
      : undefined;
  const maxOutputTokens =
    typeof model.limit?.output === "number" && model.limit.output > 0
      ? model.limit.output
      : undefined;
  const cost = model.cost;
  const costs =
    typeof cost?.input === "number" && typeof cost?.output === "number"
      ? {
          inputPerM: cost.input,
          ...(typeof cost.cache_read === "number" && {
            cacheReadPerM: cost.cache_read,
          }),
          ...(typeof cost.cache_write === "number" && {
            cacheWritePerM: cost.cache_write,
          }),
          outputPerM: cost.output,
        }
      : undefined;
  return {
    context,
    maxOutputTokens,
    costs,
    modality: catalogModalitiesToResolved(model.modalities),
  };
}

function lookupInCatalog(
  catalog: ModelsDevCatalog,
  metadataName: string,
): Pick<
  ResolvedLlmMetadata,
  "context" | "maxOutputTokens" | "costs" | "modality"
> | null {
  const targets = targetForms(metadataName);
  if (targets.length === 0) {
    return null;
  }

  const labs = new Set<string>();
  for (const key of Object.keys(catalog.models ?? {})) {
    const slash = key.indexOf("/");
    if (slash <= 0) {
      continue;
    }
    if (matchModelId(targets, key.slice(slash + 1))) {
      labs.add(key.slice(0, slash));
    }
  }

  const matches: ProviderMatch[] = [];
  for (const [providerId, provider] of Object.entries(
    catalog.providers ?? {},
  )) {
    for (const [modelKey, model] of Object.entries(provider?.models ?? {})) {
      const match =
        matchModelId(targets, modelKey) ??
        (model?.id ? matchModelId(targets, model.id) : null);
      if (match) {
        matches.push({ providerId, model, ...match });
      }
    }
  }
  if (matches.length === 0) {
    return null;
  }

  const bestTier = Math.min(...matches.map((match) => match.tier));
  const candidates = matches.filter((match) => match.tier === bestTier);
  const preferred =
    candidates.find((match) => labs.has(match.providerId)) ??
    candidates.reduce((best, match) =>
      match.lengthDiff < best.lengthDiff ? match : best,
    );
  const resolved = catalogEntryToMetadata(preferred.model);
  return resolved;
}

function configCostsToResolved(
  costs: NonNullable<LlmMetadata["costs"]>,
): ResolvedMetadataCosts {
  return {
    inputPerM: costs["input/m"],
    ...(costs["cache/m"] !== undefined && { cacheReadPerM: costs["cache/m"] }),
    outputPerM: costs["output/m"],
  };
}

const LOCAL_PROVIDERS: ReadonlySet<LlmProvider> = new Set([
  LlmProvider.LlamaCpp,
  LlmProvider.Mlx,
  LlmProvider.Ollama,
]);

export function configuredLlmContext(llm: {
  provider: LlmProvider;
  providerOptions: ProviderOptions;
  llmOptions: { context?: number };
}): number | undefined {
  if (
    llm.provider !== LlmProvider.LlamaCpp &&
    llm.provider !== LlmProvider.Mlx
  ) {
    return undefined;
  }
  const providerContext = (
    llm.providerOptions as LlamaCppProviderOptions | MlxProviderOptions
  ).context;
  return llm.llmOptions.context ?? providerContext;
}

/**
 * Resolve model metadata: config-provided `metadata` fields win, anything
 * missing is filled from the models.dev catalog, and the metadata name
 * defaults to the raw model id when no `metadata` block is configured.
 * Returns `null` when neither source yields a context size nor prices — in
 * that case nothing cost/context-related should be reported or displayed.
 *
 * When `provider` is a local provider (llama.cpp, Ollama), catalog costs are
 * discarded — the catalog prices the hosted API for the same model id, not
 * the free local inference — so only the context window resolves (config
 * `metadata.costs`, if explicitly set, is still honored).
 *
 * `configuredContext` (the runtime context actually configured on the LLM
 * entry — see {@link configuredLlmContext}) sits between the two sources:
 * an explicit `metadata.context` wins over it, and it wins over the catalog.
 * Modality always resolves, defaulting to text-only when unset.
 */
export async function resolveLlmMetadata(
  metadata: LlmMetadata | null | undefined,
  modelId: string,
  provider?: LlmProvider,
  configuredContext?: number,
): Promise<ResolvedLlmMetadata | null> {
  const name = metadata?.name ?? modelId;
  const isLocal = provider !== undefined && LOCAL_PROVIDERS.has(provider);
  let context = metadata?.context ?? configuredContext;
  let maxOutputTokens: number | undefined;
  let costs = metadata?.costs
    ? configCostsToResolved(metadata.costs)
    : undefined;
  let modality = mergeResolvedModality(metadata?.modality);

  if (
    context === undefined ||
    maxOutputTokens === undefined ||
    (costs === undefined && !isLocal) ||
    metadata?.modality === undefined
  ) {
    const catalog = await loadCatalog();
    const fromCatalog = catalog ? lookupInCatalog(catalog, name) : null;
    if (fromCatalog) {
      context ??= fromCatalog.context;
      maxOutputTokens ??= fromCatalog.maxOutputTokens;
      if (!isLocal) {
        costs ??= fromCatalog.costs;
      }
      modality = mergeResolvedModality(
        metadata?.modality,
        fromCatalog.modality,
      );
    }
  }

  if (
    context === undefined &&
    maxOutputTokens === undefined &&
    costs === undefined
  ) {
    return null;
  }
  return { name, context, maxOutputTokens, costs, modality };
}

export async function resolveEffectiveLlmOptions(llm: {
  provider: LlmProvider;
  providerOptions: ProviderOptions;
  llmOptions: LlmOptions;
  metadata?: LlmMetadata | null;
}): Promise<LlmOptions> {
  const metadata = await resolveLlmMetadata(
    llm.metadata,
    llm.llmOptions.model,
    llm.provider,
    configuredLlmContext(llm),
  ).catch(() => null);
  return withMetadataMaxTokens(llm.llmOptions, metadata);
}

export function withMetadataMaxTokens(
  llmOptions: LlmOptions,
  metadata: ResolvedLlmMetadata | null | undefined,
): LlmOptions {
  if (
    llmOptions.maxTokens !== undefined ||
    metadata?.maxOutputTokens === undefined
  ) {
    return llmOptions;
  }
  return { ...llmOptions, maxTokens: metadata.maxOutputTokens };
}

export function computeUsageCostUsd(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  },
  costs: ResolvedMetadataCosts,
): number {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;
  return (
    (input * costs.inputPerM +
      cacheRead * (costs.cacheReadPerM ?? costs.inputPerM) +
      cacheWrite * (costs.cacheWritePerM ?? costs.inputPerM) +
      output * costs.outputPerM) /
    1_000_000
  );
}

export function contextTokensFromUsage(usage: {
  inputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0) +
    (usage.cacheWriteInputTokens ?? 0)
  );
}

/** Display name + chat-LLM flag from a models.dev catalog entry. */
export type ModelsDevModelInfo = {
  displayName: string;
  isChatLlm: boolean;
};

/**
 * Ensure the models.dev catalog is loaded (refresh disk cache when stale).
 * Returns `true` when a catalog is available in memory or on disk.
 */
export async function ensureModelsDevCatalog(): Promise<boolean> {
  return (await loadCatalog()) !== null;
}

/**
 * Whether a models.dev entry looks like a chat / agent LLM (not embeddings,
 * STT/TTS, image/video generators, moderation, etc.).
 */
function isChatLlmEntry(model: ModelsDevModel): boolean {
  const family = String(model.family ?? "").toLowerCase();
  const id = String(model.id ?? "").toLowerCase();
  const nonLlm =
    /(embed|whisper|tts|stt|transcri|moderation|guard|imagine|kling|asr|realtime|dall-?e|imagen|gpt-image|chatgpt-image|omni-flash|veo|lyria|deep-research|\baqa\b|native-audio|computer-use|robotics|-image(?:-|$)|antigravity)/;
  if (nonLlm.test(family) || nonLlm.test(id)) {
    return false;
  }

  const input = (model.modalities?.input ?? ["text"]).map((value) =>
    value.toLowerCase(),
  );
  const output = (model.modalities?.output ?? ["text"]).map((value) =>
    value.toLowerCase(),
  );
  if (!output.includes("text")) {
    return false;
  }
  if (
    !input.includes("text") &&
    (input.includes("audio") || input.includes("video"))
  ) {
    return false;
  }
  // Generators expose image/audio/video in output; chat LLMs are text-out
  // (they may still accept image/pdf input).
  if (
    output.includes("image") ||
    output.includes("audio") ||
    output.includes("video")
  ) {
    return false;
  }

  if (model.tool_call === false) {
    return false;
  }
  if (model.tool_call === true) {
    return true;
  }
  return input.includes("text") && output.includes("text");
}

function findModelsDevEntry(
  catalog: ModelsDevCatalog,
  modelId: string,
  providerHint?: string,
  exactOnly = false,
): ModelsDevModel | null {
  const targets = targetForms(modelId);
  if (targets.length === 0) {
    return null;
  }

  const matches: Array<{
    providerId: string;
    model: ModelsDevModel;
    tier: 1 | 2;
    lengthDiff: number;
  }> = [];
  for (const [providerId, provider] of Object.entries(
    catalog.providers ?? {},
  )) {
    for (const [modelKey, model] of Object.entries(provider?.models ?? {})) {
      const match =
        matchModelId(targets, modelKey) ??
        (model?.id ? matchModelId(targets, model.id) : null);
      if (!match) {
        continue;
      }
      if (exactOnly && match.tier !== 1) {
        continue;
      }
      matches.push({ providerId, model, ...match });
    }
  }
  if (matches.length === 0) {
    return null;
  }

  const bestTier = Math.min(...matches.map((match) => match.tier));
  const candidates = matches.filter((match) => match.tier === bestTier);
  if (providerHint) {
    const preferred = candidates.find(
      (match) => match.providerId === providerHint,
    );
    if (preferred) {
      return preferred.model;
    }
  }
  return candidates.reduce((best, match) =>
    match.lengthDiff < best.lengthDiff ? match : best,
  ).model;
}

/**
 * Look up a model in the models.dev catalog (ensuring the cache is warm).
 * `providerHint` should be a models.dev provider id when known (e.g.
 * `moonshotai`, `amazon-bedrock`).
 *
 * Pass `{ exact: true }` to require an exact id match (used by prefetch so
 * `gpt-4o-transcribe` does not inherit `gpt-4o`'s chat-LLM metadata).
 */
export async function resolveModelsDevModelInfo(
  modelId: string,
  providerHint?: string,
  options?: { exact?: boolean },
): Promise<ModelsDevModelInfo | null> {
  const catalog = await loadCatalog();
  if (!catalog) {
    return null;
  }
  const entry = findModelsDevEntry(
    catalog,
    modelId,
    providerHint,
    options?.exact === true,
  );
  if (!entry) {
    return null;
  }
  const displayName =
    typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : modelId;
  return { displayName, isChatLlm: isChatLlmEntry(entry) };
}

/**
 * Chat / agent LLMs listed under a models.dev provider id (e.g. `google`).
 * Used as the allowlist for hosted prefetch so specialty API-only models
 * (Veo, Deep Research, …) that never appear on models.dev stay out.
 */
export async function listModelsDevChatLlms(
  providerId: string,
): Promise<Array<{ id: string; displayName: string }>> {
  const catalog = await loadCatalog();
  if (!catalog) {
    return [];
  }
  const provider = catalog.providers?.[providerId];
  const rows: Array<{ id: string; displayName: string }> = [];
  for (const [modelKey, model] of Object.entries(provider?.models ?? {})) {
    if (!model || !isChatLlmEntry(model)) {
      continue;
    }
    const id =
      typeof model.id === "string" && model.id.trim()
        ? model.id.trim()
        : modelKey;
    const displayName =
      typeof model.name === "string" && model.name.trim()
        ? model.name.trim()
        : id;
    rows.push({ id, displayName });
  }
  return rows;
}
