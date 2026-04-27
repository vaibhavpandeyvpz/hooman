import { createMoonshotAI, moonshotai } from "@ai-sdk/moonshotai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { MoonshotAIProviderSettings } from "@ai-sdk/moonshotai";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import lodash from "lodash";

const { omit, pick } = lodash;

const PROVIDER_SETTINGS_KEYS = [
  "apiKey",
  "baseURL",
  "headers",
  "fetch",
] as const;

function pickProviderSettings(
  params: Record<string, unknown>,
): MoonshotAIProviderSettings {
  const picked = pick(params, [...PROVIDER_SETTINGS_KEYS]) as Record<
    string,
    unknown
  >;
  const unset = Object.keys(picked).filter((k) => picked[k] === undefined);
  return omit(picked, unset) as MoonshotAIProviderSettings;
}

function pickVercelModelConfig(
  params: Record<string, unknown>,
): Partial<VercelModelConfig> {
  return omit(params, [
    ...PROVIDER_SETTINGS_KEYS,
  ]) as Partial<VercelModelConfig>;
}

/**
 * Moonshot AI via AI SDK + Strands {@link VercelModel}.
 *
 * - **`config.llm.model`**: model id passed to `moonshotai(...)` (e.g. `kimi-k2.5`).
 * - **`params`**: {@link MoonshotAIProviderSettings} (`apiKey`, `baseURL`, `headers`, `fetch`).
 *   If none are set, the default provider is used (`MOONSHOT_API_KEY` from env).
 * - Any other `params` keys are forwarded as {@link VercelModelConfig} (e.g. `temperature`,
 *   `maxTokens`, `providerOptions`).
 */
export function create(
  model: string,
  params: Record<string, unknown> = {},
): VercelModel {
  const settings = pickProviderSettings(params);
  const provider =
    Object.keys(settings).length > 0 ? createMoonshotAI(settings) : moonshotai;
  const config = pickVercelModelConfig(params);
  return new VercelModel({
    provider: provider(model),
    ...config,
  });
}
