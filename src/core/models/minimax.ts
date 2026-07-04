import { createAnthropic } from "@ai-sdk/anthropic";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import type { LlmOptions, MinimaxProviderOptions } from "./types.js";
import { markTotalInclusiveInputUsage } from "./usage.js";

const DEFAULT_BASE_URL = "https://api.minimax.io/anthropic";

// MiniMax's adaptive thinking accepts effort via `output_config.effort`, which
// only takes low/medium/high; `minimal` collapses to `low`.
const OUTPUT_CONFIG_EFFORT: Record<
  NonNullable<MinimaxProviderOptions["reasoning"]>["effort"] & string,
  "low" | "medium" | "high"
> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

export function create(
  providerOptions: MinimaxProviderOptions,
  llmOptions: LlmOptions,
): VercelModel {
  const provider = createAnthropic({
    baseURL: providerOptions.baseURL ?? DEFAULT_BASE_URL,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(providerOptions.headers ? { headers: providerOptions.headers } : {}),
  });

  // Providing `reasoning` enables MiniMax thinking via the adaptive scheme
  // (`thinking: { type: "adaptive" }` + `output_config.effort`); effort defaults
  // to `medium`. `display` is forwarded when set. Omitting `reasoning` leaves
  // thinking at the model default.
  const reasoning = providerOptions.reasoning;
  const anthropicProviderOptions = reasoning
    ? {
        thinking: {
          type: "adaptive" as const,
          ...(reasoning.display ? { display: reasoning.display } : {}),
        },
        effort: OUTPUT_CONFIG_EFFORT[reasoning.effort ?? "medium"],
      }
    : undefined;

  const config: Partial<VercelModelConfig> = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(anthropicProviderOptions
      ? { providerOptions: { anthropic: anthropicProviderOptions } }
      : {}),
  };

  const model = new VercelModel({
    provider: provider(llmOptions.model),
    ...config,
  });
  // The AI SDK Anthropic provider reports `inputTokens.total` inclusive of cache
  // reads/writes (unlike the native Anthropic-style additive shape).
  markTotalInclusiveInputUsage(model);
  return model;
}
