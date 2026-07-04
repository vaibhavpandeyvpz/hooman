import { z } from "zod";

export enum LlmProvider {
  Anthropic = "anthropic",
  Azure = "azure",
  Bedrock = "bedrock",
  Google = "google",
  Groq = "groq",
  Minimax = "minimax",
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
 * (Anthropic/MiniMax via the Anthropic API, Bedrock Converse). We always send a
 * budget rather than omitting it; `medium` is the default when no effort is set.
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
};

/**
 * Per-million-token USD prices for a model. `cache/m` is the cached-input
 * (cache read) price; cache writes are billed at the `input/m` rate when only
 * these config-provided prices are available.
 */
export type LlmBillingCosts = {
  "input/m": number;
  "cache/m"?: number;
  "output/m": number;
};

/**
 * Optional billing metadata on a named LLM. `name` is the model identifier
 * used to look the model up on models.dev (defaults to `options.model` when
 * `billing` is omitted entirely); `context`/`costs` override whatever the
 * models.dev catalog resolves.
 */
export type LlmBilling = {
  name: string;
  context?: number;
  costs?: LlmBillingCosts;
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

export type MinimaxProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. Providing `reasoning` enables thinking, normalized to
   * MiniMax's `thinking: { type: "adaptive", budget_tokens }`; omit `reasoning`
   * to leave thinking off. `effort` defaults to `medium` and maps to an explicit
   * `budget_tokens` (always sent).
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
  | MinimaxProviderOptions
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
  })
  .strict();

export const LlmBillingCostsSchema = z
  .object({
    "input/m": z.number().nonnegative(),
    "cache/m": z.number().nonnegative().optional(),
    "output/m": z.number().nonnegative(),
  })
  .strict();

export const LlmBillingSchema = z
  .object({
    name: NonEmptyStringSchema,
    context: z.number().int().positive().optional(),
    costs: LlmBillingCostsSchema.optional(),
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

export const MinimaxProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
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
  [LlmProvider.Minimax]: MinimaxProviderOptionsSchema,
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
      provider: z.literal(LlmProvider.Minimax),
      options: MinimaxProviderOptionsSchema,
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
    billing: LlmBillingSchema.nullish(),
    default: z.boolean().default(false),
  })
  .strict();

export type NamedProviderConfig = z.infer<typeof NamedProviderConfigSchema>;
export type NamedLlmConfig = z.infer<typeof NamedLlmConfigSchema>;
