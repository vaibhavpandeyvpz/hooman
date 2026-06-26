import { create as createAnthropicModel } from "./anthropic.js";
import type { LlmOptions, MinimaxProviderOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://api.minimax.io/anthropic";

export function create(
  providerOptions: MinimaxProviderOptions,
  llmOptions: LlmOptions,
) {
  return createAnthropicModel(
    {
      apiKey: providerOptions.apiKey,
      baseURL: DEFAULT_BASE_URL,
      headers: providerOptions.headers,
      thinking: providerOptions.thinking,
    },
    llmOptions,
  );
}
