import type { Usage } from "@strands-agents/sdk";

/**
 * Mirrors Strands’ `accumulateUsage` / `createEmptyUsage` (`models/streaming` in the SDK). They are not re-exported from the
 * `@strands-agents/sdk` package entry, and deep imports are blocked by `package.json` `exports`.
 */
export function createEmptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function accumulateUsage(target: Usage, source: Usage): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.totalTokens += source.totalTokens;
  if (source.cacheReadInputTokens !== undefined) {
    target.cacheReadInputTokens =
      (target.cacheReadInputTokens ?? 0) + source.cacheReadInputTokens;
  }
  if (source.cacheWriteInputTokens !== undefined) {
    target.cacheWriteInputTokens =
      (target.cacheWriteInputTokens ?? 0) + source.cacheWriteInputTokens;
  }
}
