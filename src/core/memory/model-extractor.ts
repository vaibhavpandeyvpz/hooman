import type {
  ExtractionResult,
  Extractor,
  ExtractorContext,
  JSONValue,
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
        "Save one durable fact that should persist across future sessions using the ExtractionResult shape.",
      inputSchema: z.object({
        content: z
          .string()
          .min(1)
          .describe("A short, standalone durable fact worth remembering."),
        metadata: z
          .record(z.string(), z.json())
          .optional()
          .describe("Optional JSON metadata for the memory entry."),
      }),
      callback: ({ content, metadata }) => {
        const entry = normalizeEntry({ content, metadata });
        if (!entry || remembered.size >= MAX_MEMORY_ENTRIES) {
          return { saved: false };
        }
        remembered.set(createFingerprint(entry), entry);
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

function normalizeEntry(entry: ExtractionResult): ExtractionResult | undefined {
  const content = normalizeContent(entry.content);
  if (!content) {
    return undefined;
  }

  const metadata = normalizeMetadata(entry.metadata);
  return metadata ? { content, metadata } : { content };
}

function normalizeMetadata(
  metadata: Record<string, JSONValue> | undefined,
): Record<string, JSONValue> | undefined {
  if (!metadata) {
    return undefined;
  }
  const pairs = Object.entries(metadata).filter(
    ([, value]) => value !== undefined,
  );
  if (pairs.length === 0) {
    return undefined;
  }
  return Object.fromEntries(pairs);
}

function createFingerprint(entry: ExtractionResult): string {
  return JSON.stringify({
    content: entry.content.toLowerCase(),
    metadata: entry.metadata ?? null,
  });
}
