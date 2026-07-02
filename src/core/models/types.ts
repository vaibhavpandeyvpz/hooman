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

export type OllamaThinking = boolean | "high" | "medium" | "low";
export type OpenAIApi = "chat" | "responses";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";

/**
 * Common reasoning/thinking controls shared across providers.
 * - `effort`: normalized reasoning effort. Its presence enables thinking on
 *   Anthropic (`thinking: { type: "enabled" }`) and MiniMax (normalized to
 *   `thinking: { type: "adaptive" }`); OpenAI passes the level through.
 * - `summary`: reasoning summary verbosity (OpenAI Responses API only; ignored
 *   by other providers).
 */
export type ReasoningOptions = {
  effort?: ReasoningEffort;
  summary?: ReasoningSummary;
};

export type LlmOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
};

export type AnthropicProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. Setting `reasoning.effort` enables extended thinking
   * (`thinking: { type: "enabled" }`); omit to leave thinking off. `budget_tokens`
   * is intentionally not sent (the proxy/model default is used).
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
};

export type BedrockProviderOptions = {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  apiKey?: string;
};

export type GoogleProviderOptions = {
  apiKey?: string;
};

export type GroqProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

export type MinimaxProviderOptions = {
  apiKey?: string;
  headers?: Record<string, string>;
  /**
   * Reasoning controls. Setting `reasoning.effort` enables thinking, normalized
   * to MiniMax's `thinking: { type: "adaptive" }`; omit to leave thinking off.
   */
  reasoning?: ReasoningOptions;
};

export type MoonshotProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

export type OllamaProviderOptions = {
  baseURL?: string;
  thinking?: OllamaThinking;
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
   *   not implement the Responses API. Reasoning is not surfaced in this mode.
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
};

export type XaiProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
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
export const ReasoningOptionsSchema = z
  .object({
    effort: ReasoningEffortSchema.optional(),
    summary: ReasoningSummarySchema.optional(),
  })
  .strict();
export const OllamaThinkingSchema = z.union([
  z.boolean(),
  z.enum(["high", "medium", "low"]),
]);

export const LlmOptionsSchema = z
  .object({
    model: NonEmptyStringSchema,
    temperature: z.number().finite().optional(),
    maxTokens: z.number().int().positive().optional(),
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
  })
  .strict();

export const BedrockProviderOptionsSchema = z
  .object({
    region: NonEmptyStringSchema.optional(),
    accessKeyId: NonEmptyStringSchema.optional(),
    secretAccessKey: NonEmptyStringSchema.optional(),
    sessionToken: NonEmptyStringSchema.optional(),
    apiKey: NonEmptyStringSchema.optional(),
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
  })
  .strict();

export const GroqProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
  })
  .strict();

export const MinimaxProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
    reasoning: ReasoningOptionsSchema.optional(),
  })
  .strict();

export const MoonshotProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
  })
  .strict();

export const OllamaProviderOptionsSchema = z
  .object({
    baseURL: NonEmptyStringSchema.optional(),
    thinking: OllamaThinkingSchema.optional(),
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
  })
  .strict();

export const XaiProviderOptionsSchema = z
  .object({
    apiKey: NonEmptyStringSchema.optional(),
    baseURL: NonEmptyStringSchema.optional(),
    headers: HeadersSchema,
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
    default: z.boolean().default(false),
  })
  .strict();

export type NamedProviderConfig = z.infer<typeof NamedProviderConfigSchema>;
export type NamedLlmConfig = z.infer<typeof NamedLlmConfigSchema>;
