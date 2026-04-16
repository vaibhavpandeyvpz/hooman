import { createXai, xai } from "@ai-sdk/xai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { XaiProviderSettings } from "@ai-sdk/xai";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import { omit, pick } from "lodash";

const PROVIDER_SETTINGS_KEYS = ["apiKey", "baseURL", "headers"] as const;

function pickProviderSettings(
  params: Record<string, unknown>,
): XaiProviderSettings {
  const picked = pick(params, [...PROVIDER_SETTINGS_KEYS]) as Record<
    string,
    unknown
  >;
  const unset = Object.keys(picked).filter((k) => picked[k] === undefined);
  return omit(picked, unset) as XaiProviderSettings;
}

function pickVercelModelConfig(
  params: Record<string, unknown>,
): Partial<VercelModelConfig> {
  return omit(params, [
    ...PROVIDER_SETTINGS_KEYS,
  ]) as Partial<VercelModelConfig>;
}

/**
 * xAI (Grok) via AI SDK + Strands {@link VercelModel}.
 *
 * - **`config.llm.model`**: model id passed to `xai(...)` (e.g. `grok-4.20-non-reasoning`).
 * - **`params`**: {@link XaiProviderSettings} (`apiKey`, `baseURL`, `headers`).
 *   If none are set, the default provider is used (`XAI_API_KEY` from env).
 * - Any other `params` keys are forwarded as {@link VercelModelConfig} (e.g. `temperature`, `maxTokens`).
 */
export function create(
  model: string,
  params: Record<string, unknown> = {},
): VercelModel {
  const settings = pickProviderSettings(params);
  const provider = Object.keys(settings).length > 0 ? createXai(settings) : xai;
  const config = pickVercelModelConfig(params);
  return new VercelModel({
    provider: provider(model),
    ...config,
  });
}
