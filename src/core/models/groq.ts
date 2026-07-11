import { createGroq, groq } from "@ai-sdk/groq";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { GroqProviderSettings } from "@ai-sdk/groq";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import type { GroqProviderOptions, LlmOptions } from "./types.js";
import { markTotalInclusiveInputUsage } from "../utils/usage.js";

/**
 * Groq's accepted `reasoning_effort` values are model-family-specific
 * (https://console.groq.com/docs/reasoning):
 * - Qwen: `none` | `default` only
 * - GPT-OSS: `low` | `medium` | `high` only (`reasoning_format` unsupported)
 *
 * Map Hooman's unified effort rungs onto those sets. When effort is unset,
 * omit the parameter and leave Groq's model default.
 */
function groqReasoningProviderOptions(
  modelId: string,
  effort: string | undefined,
): Record<string, string> | undefined {
  if (effort === undefined) {
    return undefined;
  }

  const id = modelId.toLowerCase();

  if (id.includes("qwen")) {
    // Any enabled Hooman level → Groq `default` (Qwen rejects low/medium/high).
    return {
      reasoningEffort: "default",
      reasoningFormat: "parsed",
    };
  }

  if (id.includes("gpt-oss")) {
    const mapped =
      effort === "high" || effort === "medium"
        ? effort
        : "low"; /* minimal / low */
    return { reasoningEffort: mapped };
  }

  return {
    reasoningEffort: effort === "minimal" ? "low" : effort,
    reasoningFormat: "parsed",
  };
}

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
  const groqOptions = groqReasoningProviderOptions(
    llmOptions.model,
    providerOptions.reasoning?.effort,
  );
  const config: Partial<VercelModelConfig> = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.topP !== undefined ? { topP: llmOptions.topP } : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(groqOptions ? { providerOptions: { groq: groqOptions } } : {}),
  };
  const model = new VercelModel({
    provider: provider(llmOptions.model),
    ...config,
  });
  // Groq reports `prompt_tokens` inclusive of any cached tokens.
  markTotalInclusiveInputUsage(model);
  return model;
}
