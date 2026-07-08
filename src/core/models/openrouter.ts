import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import type { LlmOptions, OpenRouterProviderOptions } from "./types.js";
import { markTotalInclusiveInputUsage } from "../utils/usage.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
// `providerOptionsName` is derived from the provider name, so reasoning options
// are read from `providerOptions.openrouter`.
const PROVIDER_NAME = "openrouter";

export type OpenRouterModelParams = OpenRouterProviderOptions & LlmOptions;

export function create(
  providerOptions: OpenRouterProviderOptions,
  llmOptions: LlmOptions,
): VercelModel {
  const settings: OpenAICompatibleProviderSettings = {
    name: PROVIDER_NAME,
    baseURL: providerOptions.baseURL ?? DEFAULT_BASE_URL,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(providerOptions.headers ? { headers: providerOptions.headers } : {}),
  };
  const provider = createOpenAICompatible(settings);
  // The openai-compatible adapter surfaces `reasoning_content`/`reasoning`
  // deltas (which the SDK maps to reasoningContentDelta) — unlike the OpenAI
  // Chat Completions adapter, which drops them. `reasoning.effort` maps to
  // `reasoning_effort`, which OpenRouter normalizes for reasoning models.
  const config: Partial<VercelModelConfig> = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.topP !== undefined ? { topP: llmOptions.topP } : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(providerOptions.reasoning?.effort
      ? {
          providerOptions: {
            [PROVIDER_NAME]: {
              reasoningEffort: providerOptions.reasoning.effort,
            },
          },
        }
      : {}),
  };
  const model = new VercelModel({
    provider: provider(llmOptions.model),
    ...config,
  });
  // OpenRouter reports `prompt_tokens` inclusive of `cached_tokens`.
  markTotalInclusiveInputUsage(model);
  return model;
}
