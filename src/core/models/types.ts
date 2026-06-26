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

export type AnthropicThinking = "disabled" | "adaptive";
export type OllamaThinking = boolean | "high" | "medium" | "low";

export type LlmOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
};

export type AnthropicProviderOptions = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  thinking?: AnthropicThinking;
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
  thinking?: AnthropicThinking;
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

export const AnthropicThinkingSchema = z.enum(["disabled", "adaptive"]);
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
    thinking: AnthropicThinkingSchema.optional(),
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
    thinking: AnthropicThinkingSchema.optional(),
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
