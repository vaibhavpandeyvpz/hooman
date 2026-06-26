import { createGroq, groq } from "@ai-sdk/groq";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { GroqProviderSettings } from "@ai-sdk/groq";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import type { GroqProviderOptions, LlmOptions } from "./types.js";

export function create(
  providerOptions: GroqProviderOptions,
  llmOptions: LlmOptions,
): VercelModel {
  const settings = Object.fromEntries(
    Object.entries({
      apiKey: providerOptions.apiKey,
      baseURL: providerOptions.baseURL,
      headers: providerOptions.headers,
    }).filter((entry) => entry[1] !== undefined),
  ) as GroqProviderSettings;
  const provider =
    Object.keys(settings).length > 0 ? createGroq(settings) : groq;
  const config: Partial<VercelModelConfig> = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
  };
  return new VercelModel({
    provider: provider(llmOptions.model),
    ...config,
  });
}
