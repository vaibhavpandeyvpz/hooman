import type { ClientOptions } from "@anthropic-ai/sdk";
import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import type { AnthropicProviderOptions, LlmOptions } from "./types.js";

export type AnthropicModelParams = AnthropicProviderOptions & LlmOptions;

export function create(
  providerOptions: AnthropicProviderOptions,
  llmOptions: LlmOptions,
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
  const params =
    providerOptions.thinking !== undefined
      ? { thinking: { type: providerOptions.thinking } }
      : undefined;

  return new AnthropicModel({
    modelId: llmOptions.model,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(clientConfig && Object.keys(clientConfig).length > 0
      ? { clientConfig }
      : {}),
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(params ? { params } : {}),
  });
}
