import { createMoonshotAI, moonshotai } from "@ai-sdk/moonshotai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { MoonshotAIProviderSettings } from "@ai-sdk/moonshotai";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import { Message } from "@strands-agents/sdk";
import type { ContentBlock, StreamOptions } from "@strands-agents/sdk";
import type { LlmOptions, MoonshotProviderOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

export function create(
  providerOptions: MoonshotProviderOptions,
  llmOptions: LlmOptions,
): VercelModel {
  const settings = Object.fromEntries(
    Object.entries({
      apiKey: providerOptions.apiKey,
      baseURL: providerOptions.baseURL ?? DEFAULT_BASE_URL,
      headers: providerOptions.headers,
    }).filter((entry) => entry[1] !== undefined),
  ) as MoonshotAIProviderSettings;
  const provider =
    Object.keys(settings).length > 0 ? createMoonshotAI(settings) : moonshotai;
  // Kimi reads `thinking` from `providerOptions.moonshotai`. Any effort just
  // enables it (`budgetTokens` is left to the model default).
  const config: Partial<VercelModelConfig> = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(providerOptions.reasoning?.effort
      ? { providerOptions: { moonshotai: { thinking: { type: "enabled" } } } }
      : {}),
  };
  return new MoonshotModel({
    provider: provider(llmOptions.model),
    ...config,
  });
}

class MoonshotModel extends VercelModel {
  override stream(messages: Message[], options?: StreamOptions) {
    return super.stream(normalize(messages), options);
  }
}

function normalize(messages: Message[]): Message[] {
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
