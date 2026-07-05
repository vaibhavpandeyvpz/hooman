import { StrandsMlxModel } from "./strands-mlx.js";
import { REASONING_BUDGET_TOKENS } from "../types.js";
import type { MlxProviderOptions, LlmOptions } from "../types.js";

/**
 * Strands {@link Model} backed by in-process Apple MLX via `@mlx-node/lm`
 * (Apple Silicon Metal GPU; supported architectures: Qwen3, Qwen3.5
 * dense/MoE, Gemma 4, LFM2.5). MLX-format weights (e.g. `mlx-community`
 * repos) are fetched from the Hugging Face Hub via `@huggingface/hub` into
 * `~/.hooman/cache/huggingface` on first use.
 */
export function create(
  providerOptions: MlxProviderOptions,
  llmOptions: LlmOptions,
): StrandsMlxModel {
  // Shared `reasoning` semantics: presence enables thinking (the model thinks
  // naturally, `effort` capping thought tokens via the runtime's
  // thinking-token budget); omitting it disables thinking (the chat template
  // closes the think block immediately and drops reasoning content).
  const reasoning = providerOptions.reasoning;
  const effort = reasoning?.effort;
  return new StrandsMlxModel({
    modelId: llmOptions.model,
    ...(providerOptions.hfToken ? { hfToken: providerOptions.hfToken } : {}),
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
