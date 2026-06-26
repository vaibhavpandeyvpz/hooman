import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import type { ClientOptions } from "openai";
import type { LlmOptions, OpenRouterProviderOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterModelParams = OpenRouterProviderOptions & LlmOptions;

export function create(
  providerOptions: OpenRouterProviderOptions,
  llmOptions: LlmOptions,
): OpenAIModel {
  const clientConfig: ClientOptions = {
    baseURL: providerOptions.baseURL ?? DEFAULT_BASE_URL,
    ...(providerOptions.headers
      ? { defaultHeaders: providerOptions.headers }
      : {}),
  };
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
