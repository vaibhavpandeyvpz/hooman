import type {
  ExtractionResult,
  Extractor,
  ExtractorContext,
  MessageData,
} from "@strands-agents/sdk";
import { Agent, tool } from "@strands-agents/sdk";
import type { Model } from "@strands-agents/sdk";
import { z } from "zod";
import { readBundledPrompt } from "../prompts/bundled.js";

type Options = {
  model?: Model;
  systemPrompt?: string;
};

const DEFAULT_SYSTEM_PROMPT = readBundledPrompt("static", "memory.md");

const MAX_MEMORY_ENTRIES = 5;

export class ToolBasedModelExtractor implements Extractor {
  private readonly model?: Model;
  private readonly systemPrompt: string;

  constructor(options: Options = {}) {
    this.model = options.model;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async extract(
    messages: MessageData[],
    context?: ExtractorContext,
  ): Promise<ExtractionResult[]> {
    const model = this.model ?? context?.defaultModel;
    if (!model) {
      throw new Error(
        "ToolBasedModelExtractor: no model configured and no default model available",
      );
    }
    if (messages.length === 0) {
      return [];
    }

    const remembered = new Map<string, ExtractionResult>();
    const remember = tool({
      name: "remember",
      description:
        "Save one durable fact that should persist across future sessions.",
      inputSchema: z.object({
        content: z
          .string()
          .min(1)
          .describe("A short, standalone durable fact worth remembering."),
      }),
      callback: ({ content }) => {
        const normalized = normalizeContent(content);
        if (!normalized || remembered.size >= MAX_MEMORY_ENTRIES) {
          return { saved: false };
        }
        remembered.set(normalized.toLowerCase(), { content: normalized });
        return { saved: true };
      },
    });

    const transcript = messages.map(renderMessage).join("\n");
    const extractor = new Agent({
      model,
      systemPrompt: this.systemPrompt,
      tools: [remember],
      printer: false,
    });

    await extractor.invoke(
      `Extract durable facts from this transcript.\n\n${transcript}`,
      {
        limits: {
          turns: 4,
          outputTokens: 512,
        },
      },
    );

    return [...remembered.values()];
  }
}

function renderMessage(message: MessageData): string {
  const text = message.content
    .map((block) => ("text" in block ? block.text : ""))
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n");
  return `${message.role}: ${text}`;
}

function normalizeContent(content: string): string | undefined {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length < 8) {
    return undefined;
  }
  return normalized;
}
