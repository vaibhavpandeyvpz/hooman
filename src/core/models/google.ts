import { GoogleModel } from "@strands-agents/sdk/models/google";
import type { GoogleModelOptions } from "@strands-agents/sdk/models/google";
import type { GoogleProviderOptions, LlmOptions } from "./types.js";

export function create(
  providerOptions: GoogleProviderOptions,
  llmOptions: LlmOptions,
): GoogleModel {
  const params = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.topP !== undefined ? { topP: llmOptions.topP } : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxOutputTokens: llmOptions.maxTokens }
      : {}),
    // Any effort enables Gemini thinking and streams thoughts; `thinkingBudget:
    // -1` lets the model size the budget dynamically (no fixed budget).
    ...(providerOptions.reasoning?.effort
      ? { thinkingConfig: { includeThoughts: true, thinkingBudget: -1 } }
      : {}),
  };
  return new GoogleModel({
    modelId: llmOptions.model,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
  } as GoogleModelOptions);
}
