import type { ClientOptions } from "@anthropic-ai/sdk";
import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import type {
  AnthropicProviderOptions,
  LlmOptions,
  ReasoningEffort,
} from "./types.js";
import { REASONING_BUDGET_TOKENS } from "./types.js";

export type AnthropicModelParams = AnthropicProviderOptions & LlmOptions;

/**
 * Anthropic-compatible thinking `type`. Real Claude uses `enabled`; MiniMax's
 * Anthropic-compatible API uses `adaptive`. In the `enabled` path we always send
 * an explicit `budget_tokens` derived from the effort (defaulting to `medium`).
 */
export type ThinkingType = "enabled" | "adaptive";

// `output_config.effort` (adaptive path) only accepts low/medium/high.
const OUTPUT_CONFIG_EFFORT: Record<ReasoningEffort, "low" | "medium" | "high"> =
  {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
  };

export function create(
  providerOptions: AnthropicProviderOptions,
  llmOptions: LlmOptions,
  thinkingType: ThinkingType = "enabled",
): AnthropicModel {
  const clientConfig: ClientOptions | undefined =
    providerOptions.baseURL || providerOptions.headers
      ? {
          ...(providerOptions.baseURL
            ? { baseURL: providerOptions.baseURL }
            : {}),
          ...(providerOptions.headers
            ? { defaultHeaders: providerOptions.headers }
            : {}),
        }
      : undefined;
  // Enable thinking whenever `reasoning` is configured; effort defaults to
  // `medium`. Setting `display` switches to the `adaptive` scheme (required by
  // newer Bedrock Claude, e.g. Opus 4.7+, which omit reasoning by default) and
  // uses `output_config.effort` instead of a fixed `budget_tokens`.
  const reasoning = providerOptions.reasoning;
  const effort = reasoning ? (reasoning.effort ?? "medium") : undefined;
  const params = ((): Record<string, unknown> | undefined => {
    if (effort === undefined) {
      return undefined;
    }
    if (reasoning?.display !== undefined) {
      return {
        thinking: { type: "adaptive", display: reasoning.display },
        output_config: { effort: OUTPUT_CONFIG_EFFORT[effort] },
      };
    }
    return {
      thinking: {
        type: thinkingType,
        budget_tokens: REASONING_BUDGET_TOKENS[effort],
      },
    };
  })();

  // Anthropic requires `temperature` to be unset (or exactly 1) when thinking is
  // enabled, so we drop any custom temperature on the thinking path.
  const sendTemperature =
    llmOptions.temperature !== undefined && params === undefined;

  return new AnthropicModel({
    modelId: llmOptions.model,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(clientConfig && Object.keys(clientConfig).length > 0
      ? { clientConfig }
      : {}),
    ...(sendTemperature ? { temperature: llmOptions.temperature } : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(params ? { params } : {}),
  });
}
