import { z } from "zod";

export enum LlmProvider {
  Anthropic = "anthropic",
  Azure = "azure",
  Bedrock = "bedrock",
  Google = "google",
  Groq = "groq",
  LlamaCpp = "llama-cpp",
  Minimax = "minimax",
  Mlx = "mlx",
  Moonshot = "moonshot",
  Ollama = "ollama",
  OpenAI = "openai",
  OpenRouter = "openrouter",
  Xai = "xai",
}

export type OpenAIApi = "chat" | "responses";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type ReasoningDisplay = "summarized" | "omitted";

/**
 * Common reasoning/thinking controls shared across every reasoning-capable
 * provider. Hooman translates this into each provider's native shape.
 * - `effort`: normalized reasoning effort. Its presence enables thinking; the
 *   level is forwarded where the backend supports effort/levels and otherwise
 *   used only to turn thinking on (see each provider factory for the exact
 *   mapping). Omit to leave thinking off.
 * - `summary`: reasoning-summary verbosity. Only OpenAI/Azure Responses API
 *   honor this; other providers ignore it.
 * - `display`: Bedrock Claude / MiniMax only. Newer Bedrock Claude models
 *   (Opus 4.7+) default reasoning display to omitted; set `"summarized"` to
 *   receive the reasoning trace. Setting it switches the request to `adaptive`
 *   thinking with `output_config.effort` (required by Opus, accepted by
 *   Sonnet/MiniMax). Do NOT set it for the native Anthropic API
 *   (api.anthropic.com), which only supports `thinking: { type: "enabled" }`
 *   and rejects `adaptive`/`display`/`output_config`.
 */
export type ReasoningOptions = {
  effort?: ReasoningEffort;
  summary?: ReasoningSummary;
  display?: ReasoningDisplay;
};

/**
 * Effort -> `budget_tokens` for providers that take an explicit thinking budget
 * (the native Anthropic API, Bedrock Converse). We always send a budget rather
 * than omitting it; `medium` is the default when no effort is set.
 */
export const REASONING_BUDGET_TOKENS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
};

export type LlmOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Context size in tokens for this model. Only honored by the local
   * `llama-cpp` and `mlx` providers (overrides the provider-level
   * `context`); other providers ignore it. For llama-cpp it sizes the
   * actual llama.cpp context; for mlx (where MLX allocates KV state
   * dynamically) it declares the model's usable window. Both feed the
   * context-usage gauge, taking precedence over the models.dev catalog
   * (an explicit `metadata.context` still wins).
   */
  context?: number;
};

/**
 * Per-million-token USD prices for a model. `cache/m` is the cached-input
 * (cache read) price; cache writes are billed at the `input/m` rate when only
 * these config-provided prices are available.
 */
export type LlmMetadataCosts = {
  "input/m": number;
  "cache/m"?: number;
  "output/m": number;
};

/**
 * Optional metadata on a named LLM. `name` is the model identifier used to
 * look the model up on models.dev (defaults to `options.model` when
 * `metadata` is omitted entirely); `context`/`costs`/`modality` override
 * whatever the models.dev catalog resolves.
 */
export type LlmInputModality = {
  text?: boolean;
  image?: boolean;
  pdf?: boolean;
  audio?: boolean;
  video?: boolean;
};

export type LlmMetadata = {
  name: string;
  context?: number;
  costs?: LlmMetadataCosts;
  modality?: LlmInputModality;
};

export type AnthropicProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. Providing `reasoning` enables extended thinking
   * (`thinking: { type: "enabled", budget_tokens }`); omit `reasoning` entirely
   * to leave thinking off. `effort` defaults to `medium` and maps to an explicit
   * `budget_tokens` (always sent).
   */
  reasoning?: ReasoningOptions;
};

export type AzureProviderOptions = {
  resourceName?: string;
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  apiVersion?: string;
  useDeploymentBasedUrls?: boolean;
  /**
   * Reasoning controls (Azure OpenAI Responses API). `effort` and `summary` are
   * forwarded to the deployment; only reasoning-capable models honor them.
   */
  reasoning?: ReasoningOptions;
};

export type BedrockProviderOptions = {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  apiKey?: string;
  /**
   * Reasoning controls. Providing `reasoning` enables extended thinking on
   * supported models (e.g. Claude), sent as `thinking: { type: "enabled",
   * budget_tokens }`. `effort` defaults to `medium` and maps to a `budget_tokens`
   * value (Converse requires an explicit budget); omit `reasoning` to leave
   * thinking off.
   */
  reasoning?: ReasoningOptions;
};

export type GoogleProviderOptions = {
  apiKey?: string;
  /**
   * Reasoning controls. Setting `reasoning.effort` enables Gemini thinking
   * (`thinkingConfig: { includeThoughts: true, thinkingBudget: -1 }` — dynamic
   * budget); omit to leave thinking at the model default.
   */
  reasoning?: ReasoningOptions;
};

export type GroqProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. `reasoning.effort` maps to Groq's `reasoning_effort`
   * (`minimal` is sent as `low`); reasoning is streamed via
   * `reasoning_format: "parsed"`. Omit to leave reasoning at the model default.
   */
  reasoning?: ReasoningOptions;
};

export type LlamaCppProviderOptions = {
  /**
   * Hugging Face access token used when downloading GGUF weights from the Hub
   * (gated/private repos). Falls back to the `HF_TOKEN` env var when unset.
   */
  hfToken?: string;
  /**
   * GPU backend forwarded to node-llama-cpp's `getLlama`. Defaults to
   * `"auto"` when unset. Set `false` to force CPU-only inference.
   */
  gpu?: "auto" | "metal" | "cuda" | "vulkan" | false;
  /**
   * Context size in tokens for the llama.cpp context. Per-LLM
   * `options.context` takes precedence; when both are omitted,
   * node-llama-cpp adapts it to the model's training context and free memory.
   */
  context?: number;
  /**
   * Whether turns may reuse KV state already evaluated by a previous turn
   * (llama.cpp context-sequence state reuse). Defaults to `true`; set
   * `false` to re-prefill the full conversation from scratch every turn.
   */
  promptCache?: boolean;
  /**
   * Reasoning controls. Providing `reasoning` enables thinking: the chat
   * template is configured to allow thought segments (Qwen `thoughts: "auto"`,
   * Gemma 4 `reasoning: true`, gpt-oss/Harmony native reasoning-effort) and
   * `effort` caps thought tokens via node-llama-cpp's thought budget
   * (1024/2048/4096/8192, default `medium`). Omit `reasoning` to disable
   * thinking (templates discourage thoughts, thought budget forced to 0).
   */
  reasoning?: ReasoningOptions;
};

export type MinimaxProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. Providing `reasoning` enables MiniMax's adaptive
   * thinking (`thinking: { type: "adaptive" }` with `output_config.effort`);
   * omit `reasoning` to leave thinking at the model default. `effort` defaults
   * to `medium` (`minimal` maps to `low`); `display` is forwarded when set.
   */
  reasoning?: ReasoningOptions;
};

/**
 * Sizing for mlex's internal prompt-cache pool (LRU + idle-TTL eviction,
 * keyed by longest exact-prefix match on token ids), applied once when the
 * model is loaded. All fields are optional overrides of mlex's own
 * defaults (`maxEntries` 16, `ttl` 300s, `minTokens` 8).
 */
export type MlxPromptCacheConfig = {
  minTokens?: number;
  maxEntries?: number;
  ttl?: number;
};

export type MlxProviderOptions = {
  /**
   * Hugging Face access token used when downloading MLX-format weights from
   * the Hub (gated/private repos). Falls back to the `HF_TOKEN` env var when
   * unset.
   */
  hfToken?: string;
  /**
   * Default context size in tokens for this provider's models. MLX
   * allocates KV state dynamically, so this doesn't size an allocation —
   * it declares the usable window for the context-usage gauge. Per-LLM
   * `options.context` takes precedence.
   */
  context?: number;
  /**
   * Whether turns may reuse KV state from mlex's internal prompt-cache
   * pool (prefix matching against previous calls), applied once when the
   * model is loaded. `undefined`, `null`, and `false` all disable caching
   * entirely; an object (even `{}`) enables it, optionally overriding
   * mlex's own pool-sizing defaults via its fields.
   */
  promptCache?: MlxPromptCacheConfig | false | null;
  /**
   * Reasoning controls. Providing `reasoning` enables thinking: the model
   * thinks naturally and `effort` caps thought tokens via the runtime's
   * thinking-token budget (1024/2048/4096/8192, default `medium`). Omit
   * `reasoning` to disable thinking (the chat template closes the think block
   * immediately and reasoning content is dropped).
   */
  reasoning?: ReasoningOptions;
};

export type MoonshotProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. Setting `reasoning.effort` enables Kimi thinking
   * (`thinking: { type: "enabled" }`); omit to leave thinking off.
   */
  reasoning?: ReasoningOptions;
};

export type OllamaProviderOptions = {
  baseURL?: string;
  /**
   * Reasoning controls. Setting `reasoning.effort` enables Ollama thinking,
   * mapped to the `think` level (`minimal`/`low` -> `"low"`, `medium` ->
   * `"medium"`, `high` -> `"high"`); omit to leave thinking off.
   */
  reasoning?: ReasoningOptions;
};

export type OpenAIProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Which OpenAI-compatible API surface to use.
   * - `responses` (default): OpenAI Responses API. Streams reasoning/thinking
   *   (`response.reasoning_summary_text.delta`) so it shows up in the UI.
   * - `chat`: Chat Completions. Use for OpenAI-compatible MaaS/proxies that do
   *   not implement the Responses API. Reasoning is NOT surfaced in this mode:
   *   the SDK's Chat adapter drops `reasoning_content`. For a MaaS/proxy that
   *   only exposes thinking via chat `reasoning_content` (e.g. Kimi/Moonshot),
   *   route it through the `moonshot` or `openrouter` provider instead, which
   *   use the reasoning-aware openai-compatible adapter.
   */
  api?: OpenAIApi;
  /**
   * Reasoning controls for the Responses API (`api: "responses"`). Ignored on
   * the Chat Completions API.
   * - `effort`: reasoning effort. Some models (e.g. GPT-5) only emit a reasoning
   *   summary at `medium` or `high`; `low`/`minimal` yield no visible thinking.
   * - `summary`: summary verbosity. Defaults to `auto`. Set to `none` to disable
   *   summaries (e.g. for non-reasoning models that reject the `reasoning` param).
   */
  reasoning?: ReasoningOptions;
};

export type OpenRouterProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. `reasoning.effort` maps to `reasoning_effort`, which
   * OpenRouter normalizes for reasoning models. OpenRouter is served through the
   * openai-compatible adapter (not the OpenAI Chat adapter) so `reasoning`/
   * `reasoning_content` deltas are surfaced as thinking. Omit to leave reasoning
   * at the default.
   */
  reasoning?: ReasoningOptions;
};

export type XaiProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. `reasoning.effort` maps to xAI's `reasoning_effort`
   * (`low`/`high`; `minimal` -> `low`, `medium` -> `high`). Only reasoning
   * models (e.g. grok-3-mini) support it. Omit to leave reasoning at the default.
   */
  reasoning?: ReasoningOptions;
};

export type ProviderOptions =
  | AnthropicProviderOptions
  | AzureProviderOptions
  | BedrockProviderOptions
  | GoogleProviderOptions
  | GroqProviderOptions
  | LlamaCppProviderOptions
  | MinimaxProviderOptions
  | MlxProviderOptions
  | MoonshotProviderOptions
  | OllamaProviderOptions
  | OpenAIProviderOptions
  | OpenRouterProviderOptions
  | XaiProviderOptions;

const NonEmptyStringSchema = z.string().min(1);
const HeadersSchema = z.record(z.string(), z.string()).optional();

export const OpenAIApiSchema = z.enum(["chat", "responses"]);
export const ReasoningEffortSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
]);
export const ReasoningSummarySchema = z.enum([
  "auto",
  "concise",
  "detailed",
  "none",
]);
export const ReasoningDisplaySchema = z.enum(["summarized", "omitted"]);
export const ReasoningOptionsSchema = z
  .object({
    effort: ReasoningEffortSchema.optional(),
    summary: ReasoningSummarySchema.optional(),
    display: ReasoningDisplaySchema.optional(),
  })
  .strict();

export const LlmOptionsSchema = z
  .object({
    model: NonEmptyStringSchema,
    temperature: z.number().finite().optional(),
    maxTokens: z.number().int().positive().optional(),
    context: z.number().int().positive().optional(),
  })
  .strict();

export const LlmMetadataCostsSchema = z
  .object({
    "input/m": z.number().nonnegative(),
    "cache/m": z.number().nonnegative().optional(),
    "output/m": z.number().nonnegative(),
  })
  .strict();

export const LlmInputModalitySchema = z
  .object({
    text: z.boolean().optional(),
    image: z.boolean().optional(),
    pdf: z.boolean().optional(),
    audio: z.boolean().optional(),
    video: z.boolean().optional(),
  })
  .strict();

export const LlmMetadataSchema = z
  .object({
    name: NonEmptyStringSchema,
    context: z.number().int().positive().optional(),
    costs: LlmMetadataCostsSchema.optional(),
    modality: LlmInputModalitySchema.optional(),
  })
  .strict();

export const AnthropicProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const AzureProviderOptionsSchema = z
  .object({
    resourceName: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    apiKey: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    apiVersion: NonEmptyStringSchema.optional(),
    useDeploymentBasedUrls: z.boolean().optional(),
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const BedrockProviderOptionsSchema = z
  .object({
    region: NonEmptyStringSchema.optional(),
    accessKeyId: NonEmptyStringSchema.optional(),
    secretAccessKey: NonEmptyStringSchema.optional(),
    sessionToken: NonEmptyStringSchema.optional(),
    apiKey: NonEmptyStringSchema.optional(),
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAccessKeyId = value.accessKeyId !== undefined;
    const hasSecretAccessKey = value.secretAccessKey !== undefined;
    if (hasAccessKeyId !== hasSecretAccessKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "`accessKeyId` and `secretAccessKey` must be provided together.",
      });
    }
  });

export const GoogleProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const GroqProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const LlamaCppProviderOptionsSchema = z.preprocess(
  // Legacy alias: `contextSize` was renamed to `context`.
  (value) => {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "contextSize" in value &&
      !("context" in value)
    ) {
      const { contextSize, ...rest } = value as Record<string, unknown>;
      return { ...rest, context: contextSize };
    }
    return value;
  },
  z
    .object({
      hfToken: NonEmptyStringSchema.optional(),
      gpu: z
        .union([z.enum(["auto", "metal", "cuda", "vulkan"]), z.literal(false)])
        .optional(),
      context: z.number().int().positive().optional(),
      promptCache: z.boolean().optional(),
      reasoning: ReasoningOptionsSchema.optional(),
    })
    .strict(),
);

export const MinimaxProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const MlxPromptCacheConfigSchema = z
  .object({
    minTokens: z.number().int().nonnegative().optional(),
    maxEntries: z.number().int().positive().optional(),
    ttl: z.number().int().positive().optional(),
  })
  .strict();

export const MlxProviderOptionsSchema = z
  .object({
    hfToken: NonEmptyStringSchema.optional(),
    context: z.number().int().positive().optional(),
    promptCache: z
      .union([MlxPromptCacheConfigSchema, z.literal(false), z.null()])
      .optional(),
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const MoonshotProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const OllamaProviderOptionsSchema = z
  .object({
    baseURL: NonEmptyStringSchema.optional(),
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const OpenAIProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    api: OpenAIApiSchema.optional(),
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const OpenRouterProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const XaiProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const ProviderOptionsSchemas = {
  [LlmProvider.Anthropic]: AnthropicProviderOptionsSchema,
  [LlmProvider.Azure]: AzureProviderOptionsSchema,
  [LlmProvider.Bedrock]: BedrockProviderOptionsSchema,
  [LlmProvider.Google]: GoogleProviderOptionsSchema,
  [LlmProvider.Groq]: GroqProviderOptionsSchema,
  [LlmProvider.LlamaCpp]: LlamaCppProviderOptionsSchema,
  [LlmProvider.Minimax]: MinimaxProviderOptionsSchema,
  [LlmProvider.Mlx]: MlxProviderOptionsSchema,
  [LlmProvider.Moonshot]: MoonshotProviderOptionsSchema,
  [LlmProvider.Ollama]: OllamaProviderOptionsSchema,
  [LlmProvider.OpenAI]: OpenAIProviderOptionsSchema,
  [LlmProvider.OpenRouter]: OpenRouterProviderOptionsSchema,
  [LlmProvider.Xai]: XaiProviderOptionsSchema,
} as const;

export const NamedProviderConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Anthropic),
      options: AnthropicProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Azure),
      options: AzureProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Bedrock),
      options: BedrockProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Google),
      options: GoogleProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Groq),
      options: GroqProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.LlamaCpp),
      options: LlamaCppProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Minimax),
      options: MinimaxProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Mlx),
      options: MlxProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Moonshot),
      options: MoonshotProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Ollama),
      options: OllamaProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.OpenAI),
      options: OpenAIProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.OpenRouter),
      options: OpenRouterProviderOptionsSchema,
    })
    .strict(),
  z
    .object({
      name: NonEmptyStringSchema,
      provider: z.literal(LlmProvider.Xai),
      options: XaiProviderOptionsSchema,
    })
    .strict(),
]);

export const NamedLlmConfigSchema = z
  .object({
    name: NonEmptyStringSchema,
    provider: NonEmptyStringSchema,
    options: LlmOptionsSchema,
    metadata: LlmMetadataSchema.nullish(),
    default: z.boolean().default(false),
  })
  .strict();

export type NamedProviderConfig = z.infer<typeof NamedProviderConfigSchema>;
export type NamedLlmConfig = z.infer<typeof NamedLlmConfigSchema>;
