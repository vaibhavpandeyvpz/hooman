import { StrandsLlamaCppModel } from "./strands-llama-cpp.js";
import { REASONING_BUDGET_TOKENS } from "../types.js";
import type { LlamaCppProviderOptions, LlmOptions } from "../types.js";

/**
 * Strands {@link Model} backed by in-process llama.cpp via `node-llama-cpp`.
 * GGUF weights are fetched from the Hugging Face Hub (via `@huggingface/hub`)
 * into `~/.hooman/cache/huggingface` on first use.
 */
export function create(
  providerOptions: LlamaCppProviderOptions,
  llmOptions: LlmOptions,
): StrandsLlamaCppModel {
  // The shared `reasoning` option follows the usual Hooman semantics: its
  // presence enables thinking (chat wrapper configured to allow thought
  // segments, effort mapped to a thought-token budget and, on Harmony models,
  // to the native reasoning-effort level); omitting it disables thinking
  // (wrappers discourage thoughts, thought budget forced to 0).
  const reasoning = providerOptions.reasoning;
  const effort = reasoning?.effort;
  return new StrandsLlamaCppModel({
    modelId: llmOptions.model,
    ...(providerOptions.hfToken ? { hfToken: providerOptions.hfToken } : {}),
    ...(providerOptions.gpu !== undefined ? { gpu: providerOptions.gpu } : {}),
    ...(providerOptions.contextSize !== undefined
      ? { contextSize: providerOptions.contextSize }
      : {}),
    ...(reasoning !== undefined
      ? {
          reasoning: { ...(effort !== undefined ? { effort } : {}) },
          thoughtBudgetTokens: REASONING_BUDGET_TOKENS[effort ?? "medium"],
        }
      : {}),
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
  });
}
