import { createGroq, groq } from "@ai-sdk/groq";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { GroqProviderSettings } from "@ai-sdk/groq";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import lodash from "lodash";

const { omit, pick } = lodash;

const PROVIDER_SETTINGS_KEYS = ["apiKey", "baseURL", "headers"] as const;

function pickProviderSettings(
  params: Record<string, unknown>,
): GroqProviderSettings {
  const picked = pick(params, [...PROVIDER_SETTINGS_KEYS]) as Record<
    string,
    unknown
  >;
  const unset = Object.keys(picked).filter((k) => picked[k] === undefined);
  return omit(picked, unset) as GroqProviderSettings;
}

function pickVercelModelConfig(
  params: Record<string, unknown>,
): Partial<VercelModelConfig> {
  return omit(params, [
    ...PROVIDER_SETTINGS_KEYS,
  ]) as Partial<VercelModelConfig>;
}

/**
 * Groq via AI SDK + Strands {@link VercelModel}.
 *
 * - **`config.llm.model`**: model id passed to `groq(...)` (e.g. `gemma2-9b-it`).
 * - **`params`**: {@link GroqProviderSettings} (`apiKey`, `baseURL`, `headers`).
 *   If none are set, the default provider is used (`GROQ_API_KEY` from env).
 * - Any other `params` keys are forwarded as {@link VercelModelConfig} (e.g. `temperature`, `maxTokens`).
 */
export function create(
  model: string,
  params: Record<string, unknown> = {},
): VercelModel {
  const settings = pickProviderSettings(params);
  const provider =
    Object.keys(settings).length > 0 ? createGroq(settings) : groq;
  const config = pickVercelModelConfig(params);
  return new VercelModel({
    provider: provider(model),
    ...config,
  });
}
