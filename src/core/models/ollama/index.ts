import { StrandsOllamaModel } from "./strands-ollama.js";
import type { LlmOptions, OllamaProviderOptions } from "../types.js";

/** Strands {@link Model} backed by local (or remote) Ollama via `ollama` JS. */
export function create(
  providerOptions: OllamaProviderOptions,
  llmOptions: LlmOptions,
): StrandsOllamaModel {
  const maxTokens =
    typeof llmOptions.maxTokens === "number" &&
    Number.isFinite(llmOptions.maxTokens)
      ? llmOptions.maxTokens
      : 64_000;
  return new StrandsOllamaModel({
    modelId: llmOptions.model,
    maxTokens,
    ...(providerOptions.baseURL ? { host: providerOptions.baseURL } : {}),
    ...(providerOptions.thinking !== undefined
      ? { think: providerOptions.thinking }
      : {}),
    ...(llmOptions.temperature !== undefined
      ? { options: { temperature: llmOptions.temperature } }
      : {}),
  });
}
