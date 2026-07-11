import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { BedrockModel } from "@strands-agents/sdk/models/bedrock";
import type { BedrockModelOptions } from "@strands-agents/sdk";
import type {
  BedrockProviderOptions,
  LlmOptions,
  ReasoningEffort,
} from "./types.js";
import { REASONING_BUDGET_TOKENS } from "./types.js";

export type BedrockLlmParams = BedrockProviderOptions & LlmOptions;

// `output_config.effort` (adaptive path) only accepts low/medium/high.
const OUTPUT_CONFIG_EFFORT: Record<ReasoningEffort, "low" | "medium" | "high"> =
  {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
  };

export function create(
  providerOptions: BedrockProviderOptions,
  llmOptions: LlmOptions,
): BedrockModel {
  const clientConfig: BedrockRuntimeClientConfig = {};
  if (providerOptions.accessKeyId && providerOptions.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: providerOptions.accessKeyId,
      secretAccessKey: providerOptions.secretAccessKey,
      ...(providerOptions.sessionToken
        ? { sessionToken: providerOptions.sessionToken }
        : {}),
    };
  } else if (providerOptions.profile?.trim()) {
    clientConfig.credentials = fromIni({
      profile: providerOptions.profile.trim(),
    });
  }
  // Enable thinking whenever `reasoning` is configured; effort defaults to
  // `medium`. Setting `display` switches to the `adaptive` scheme (required by
  // newer Bedrock Claude, e.g. Opus 4.7+, which omit reasoning by default) and
  // uses `output_config.effort` instead of a fixed `budget_tokens`. Otherwise
  // Converse requires an explicit thinking budget.
  const reasoning = providerOptions.reasoning;
  const effort = reasoning ? (reasoning.effort ?? "medium") : undefined;
  const additionalRequestFields = ((): Record<string, unknown> | undefined => {
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
        type: "enabled",
        budget_tokens: REASONING_BUDGET_TOKENS[effort],
      },
    };
  })();
  return new BedrockModel({
    modelId: llmOptions.model,
    region: providerOptions.region ?? "us-west-2",
    // Auto-inject prompt-cache points (after tools + last user message) for
    // models that support it; a no-op on models that don't.
    cacheConfig: { strategy: "auto" },
    ...(Object.keys(clientConfig).length > 0 ? { clientConfig } : {}),
    ...(providerOptions.apiKey !== undefined
      ? { apiKey: providerOptions.apiKey }
      : {}),
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.topP !== undefined ? { topP: llmOptions.topP } : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(additionalRequestFields ? { additionalRequestFields } : {}),
  } as BedrockModelOptions);
}
