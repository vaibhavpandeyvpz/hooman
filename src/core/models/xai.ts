import { createXai, xai } from "@ai-sdk/xai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { XaiProviderSettings } from "@ai-sdk/xai";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import type { LlmOptions, XaiProviderOptions } from "./types.js";
import { markTotalInclusiveInputUsage } from "../utils/usage.js";

export function create(
  providerOptions: XaiProviderOptions,
  llmOptions: LlmOptions,
): VercelModel {
  const settings = Object.fromEntries(
    Object.entries({
      apiKey: providerOptions.apiKey,
      baseURL: providerOptions.baseURL,
      headers: providerOptions.headers,
    }).filter((entry) => entry[1] !== undefined),
  ) as XaiProviderSettings;
  const provider = Object.keys(settings).length > 0 ? createXai(settings) : xai;
  // xAI's chat surface only accepts `reasoning_effort` of `low`/`high`
  // (via `providerOptions.xai`), so `minimal`/`low` -> `low`, `medium`/`high` ->
  // `high`. Only reasoning models (e.g. grok-3-mini) honor it.
  const effort = providerOptions.reasoning?.effort;
  const reasoningEffort =
    effort === undefined
      ? undefined
      : effort === "minimal" || effort === "low"
        ? "low"
        : "high";
  const config: Partial<VercelModelConfig> = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.topP !== undefined ? { topP: llmOptions.topP } : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(reasoningEffort
      ? { providerOptions: { xai: { reasoningEffort } } }
      : {}),
  };
  const model = new VercelModel({
    provider: provider(llmOptions.model),
    ...config,
  });
  // xAI reports `prompt_tokens` inclusive of `cached_tokens`.
  markTotalInclusiveInputUsage(model);
  return model;
}
