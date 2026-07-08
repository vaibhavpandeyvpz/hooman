import type { Usage } from "@strands-agents/sdk";

/**
 * Providers disagree on what `usage.inputTokens` means:
 *
 * - Anthropic-style (Anthropic, Bedrock): `inputTokens` is only the uncached
 *   portion of the prompt; cache reads/writes are reported separately and are
 *   *additive* (total prompt = input + cacheRead + cacheWrite).
 * - Total-inclusive (OpenAI, and every Vercel AI SDK adapter): `inputTokens`
 *   is the full prompt and `cacheReadInputTokens` is a *subset* of it.
 *
 * Model factories register total-inclusive instances here so metadata meters
 * can convert their usage to the additive shape before summing. This is done
 * only at the meter feed points — the raw usage must stay untouched for the
 * Strands agent loop, which uses `usage.inputTokens` as the context size for
 * proactive compaction estimates.
 */
const totalInclusiveInputModels = new WeakSet<object>();

/** Mark a model whose `usage.inputTokens` already includes cache reads. */
export function markTotalInclusiveInputUsage(model: object): void {
  totalInclusiveInputModels.add(model);
}

/**
 * Convert a usage report to the additive (Anthropic-style) shape: when the
 * model reports total-inclusive input, subtract cache reads from
 * `inputTokens`/`totalTokens` so `input + cacheRead + cacheWrite` is the true
 * prompt total regardless of provider. No-op for additive models.
 */
export function toAdditiveUsage<T extends Partial<Usage>>(
  usage: T,
  model: object | null | undefined,
): T {
  if (!model || !totalInclusiveInputModels.has(model)) {
    return usage;
  }
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  if (cacheRead <= 0) {
    return usage;
  }
  return {
    ...usage,
    ...(usage.inputTokens !== undefined && {
      inputTokens: Math.max(0, usage.inputTokens - cacheRead),
    }),
    ...(usage.totalTokens !== undefined && {
      totalTokens: Math.max(0, usage.totalTokens - cacheRead),
    }),
  };
}
