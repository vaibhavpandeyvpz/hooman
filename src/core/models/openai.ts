import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import type { ClientOptions } from "openai";
import type { LlmOptions, OpenAIProviderOptions } from "./types.js";

export type OpenAIModelParams = OpenAIProviderOptions & LlmOptions;

export function create(
  providerOptions: OpenAIProviderOptions,
  llmOptions: LlmOptions,
): OpenAIModel {
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
  return new OpenAIModel({
    api: "chat",
    modelId: llmOptions.model,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(clientConfig ? { clientConfig } : {}),
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
  } as OpenAIModelOptions);
}
