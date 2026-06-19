import { createMoonshotAI, moonshotai } from "@ai-sdk/moonshotai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { MoonshotAIProviderSettings } from "@ai-sdk/moonshotai";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import { Message } from "@strands-agents/sdk";
import type { ContentBlock, StreamOptions } from "@strands-agents/sdk";
import lodash from "lodash";

const { omit, pick } = lodash;

const PROVIDER_SETTINGS_KEYS = [
  "apiKey",
  "baseURL",
  "headers",
  "fetch",
] as const;

class MoonshotModel extends VercelModel {
  override stream(messages: Message[], options?: StreamOptions) {
    return super.stream(normalizeMessages(messages), options);
  }
}

function normalizeMessages(messages: Message[]): Message[] {
  const normalized: Message[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      normalized.push(message);
      continue;
    }

    const toolResults: ContentBlock[] = [];
    const otherContent: ContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === "toolResultBlock") {
        toolResults.push(block);
      } else {
        otherContent.push(block);
      }
    }

    if (toolResults.length > 0 && otherContent.length > 0) {
      normalized.push(new Message({ role: "user", content: toolResults }));
      normalized.push(new Message({ role: "user", content: otherContent }));
      continue;
    }

    normalized.push(message);
  }
  return normalized;
}

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
  return new MoonshotModel({
    provider: provider(model),
    ...config,
  });
}
