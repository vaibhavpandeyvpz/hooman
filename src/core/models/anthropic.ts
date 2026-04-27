import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { AnthropicProviderSettings } from "@ai-sdk/anthropic";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import lodash from "lodash";

const { omit, pick } = lodash;

const PROVIDER_SETTINGS_KEYS = [
  "apiKey",
  "authToken",
  "baseURL",
  "headers",
] as const;

function pickProviderSettings(
  params: Record<string, unknown>,
): AnthropicProviderSettings {
  const picked = pick(params, [...PROVIDER_SETTINGS_KEYS]) as Record<
    string,
    unknown
  >;
  const unset = Object.keys(picked).filter((k) => picked[k] === undefined);
  return omit(picked, unset) as AnthropicProviderSettings;
}

function pickVercelModelConfig(
  params: Record<string, unknown>,
): Partial<VercelModelConfig> {
  return omit(params, [
    ...PROVIDER_SETTINGS_KEYS,
  ]) as Partial<VercelModelConfig>;
}

/**
 * Anthropic via AI SDK + Strands {@link VercelModel}.
 *
 * - **`config.llm.model`**: model id passed to `anthropic(...)` (e.g. `claude-sonnet-4-20250514`).
 * - **`params`**: Settings {@link AnthropicProviderSettings} (`apiKey`, `authToken`, `baseURL`, …).
 *   If none are set, the default provider is used (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from env).
 * - Any other `params` keys are forwarded as {@link VercelModelConfig} (e.g. `temperature`, `maxTokens`).
 */
export function create(
  model: string,
  params: Record<string, unknown> = {},
): VercelModel {
  const settings = pickProviderSettings(params);
  const provider =
    Object.keys(settings).length > 0 ? createAnthropic(settings) : anthropic;
  const config = pickVercelModelConfig(params);
  return new VercelModel({
    provider: provider(model),
    ...config,
  });
}
