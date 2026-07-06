import { StrandsMlxModel } from "./strands-mlx.js";
import { REASONING_BUDGET_TOKENS } from "../types.js";
import { markTotalInclusiveInputUsage } from "../usage.js";
import type { MlxProviderOptions, LlmOptions } from "../types.js";

/**
 * Strands {@link Model} backed by in-process Apple MLX via `mlex.js`
 * (Apple Silicon Metal GPU; supported architectures: Qwen2/Llama-shaped,
 * Qwen3, Qwen3.5 dense/MoE/vision, Gemma 4 text/multi-modal, NemotronH,
 * DharaAR). Any quantization scheme MLX ships loads — bf16/fp16, affine
 * 2–8 bit, mxfp4/mxfp8/nvfp4, and mixed per-layer checkpoints like OptiQ or
 * Google QAT. MLX-format weights (e.g. `mlx-community` repos) are fetched
 * from the Hugging Face Hub via `@huggingface/hub` into
 * `~/.hooman/cache/huggingface` on first use.
 */
export function create(
  providerOptions: MlxProviderOptions,
  llmOptions: LlmOptions,
): StrandsMlxModel {
  // Shared `reasoning` semantics: presence enables thinking (`effort`
  // capping the reasoning span via mlex's reasoningBudgetTokens); omitting
  // it renders the chat template with thinking off.
  const reasoning = providerOptions.reasoning;
  const effort = reasoning?.effort;
  // `undefined`/`null`/`false` all disable caching; an object (even `{}`)
  // enables it. Normalize `null` away since the internal model config only
  // distinguishes `MlxPromptCacheConfig | false`.
  const promptCache = providerOptions.promptCache;
  const model = new StrandsMlxModel({
    modelId: llmOptions.model,
    ...(providerOptions.hfToken ? { hfToken: providerOptions.hfToken } : {}),
    ...(promptCache !== undefined
      ? { promptCache: promptCache === null ? false : promptCache }
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
  // mlex usage is OpenAI-style: promptTokens includes cachedTokens.
  markTotalInclusiveInputUsage(model);
  return model;
}
