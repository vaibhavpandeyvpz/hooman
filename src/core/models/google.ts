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
    ...(llmOptions.maxTokens !== undefined
      ? { maxOutputTokens: llmOptions.maxTokens }
      : {}),
  };
  return new GoogleModel({
    modelId: llmOptions.model,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
  } as GoogleModelOptions);
}
