import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Message } from "@strands-agents/sdk";
import type { StreamOptions } from "@strands-agents/sdk";
import type { ModelStreamEvent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type {
  OpenAIChatConfig,
  OpenAIModelOptions,
} from "@strands-agents/sdk/models/openai";
import OpenAI from "openai";
import {
  applyKimiReasoningReplayToChatRequest,
  collectReasoningTextPerWireAssistant,
  stripAssistantReasoningBlocks,
} from "./openai-chat-request-shims.js";
import { splitUsageOntoEmptyChoicesChunk } from "../openai/openai-stream-shims.js";

/** Strands 1.x moves chat helpers into `chat-adapter.js`, which is not a package export; load it next to the public `models/openai` entry. */
function openAiChatAdapterUrl(): string {
  return pathToFileURL(
    join(
      dirname(
        fileURLToPath(import.meta.resolve("@strands-agents/sdk/models/openai")),
      ),
      "chat-adapter.js",
    ),
  ).href;
}

let chatAdapterPromise: Promise<{
  formatChatRequest: (
    config: OpenAIChatConfig,
    messages: Message[],
    options?: StreamOptions,
  ) => OpenAI.Chat.ChatCompletionCreateParamsStreaming;
  mapChatChunkToEvents: (
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
    state: { messageStarted: boolean; textContentBlockStarted: boolean },
    activeToolCalls: Map<number, boolean>,
  ) => ModelStreamEvent[];
}> | null = null;

function loadOpenAiChatAdapter() {
  chatAdapterPromise ??= import(openAiChatAdapterUrl());
  return chatAdapterPromise;
}

type TensorZeroStreamState = {
  messageStarted: boolean;
  textContentBlockStarted: boolean;
  reasoningContentBlockStarted: boolean;
};

function preludeEventsForTensorZeroDelta(
  delta: Record<string, unknown> | undefined,
  streamState: TensorZeroStreamState,
): ModelStreamEvent[] {
  const out: ModelStreamEvent[] = [];
  if (!delta) {
    return out;
  }

  const toolCalls = delta.tool_calls;
  if (
    Array.isArray(toolCalls) &&
    toolCalls.length > 0 &&
    streamState.reasoningContentBlockStarted
  ) {
    out.push({ type: "modelContentBlockStopEvent" });
    streamState.reasoningContentBlockStarted = false;
  }

  const extra = delta.tensorzero_extra_content;
  if (Array.isArray(extra)) {
    for (const item of extra) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      if (rec.type !== "thought") {
        continue;
      }
      const text = rec.text;
      if (typeof text !== "string" || text.length === 0) {
        continue;
      }
      if (!streamState.reasoningContentBlockStarted) {
        out.push({ type: "modelContentBlockStartEvent" });
        streamState.reasoningContentBlockStarted = true;
      }
      out.push({
        type: "modelContentBlockDeltaEvent",
        delta: { type: "reasoningContentDelta", text },
      });
    }
  }

  const content = delta.content;
  if (
    typeof content === "string" &&
    content.length > 0 &&
    streamState.reasoningContentBlockStarted
  ) {
    out.push({ type: "modelContentBlockStopEvent" });
    streamState.reasoningContentBlockStarted = false;
  }

  return out;
}

function injectReasoningStopBeforeMessageStop(
  events: ModelStreamEvent[],
  streamState: TensorZeroStreamState,
): ModelStreamEvent[] {
  const out: ModelStreamEvent[] = [];
  for (const e of events) {
    if (
      e.type === "modelMessageStopEvent" &&
      streamState.reasoningContentBlockStarted
    ) {
      out.push({ type: "modelContentBlockStopEvent" });
      streamState.reasoningContentBlockStarted = false;
    }
    out.push(e);
  }
  return out;
}

/**
 * {@link OpenAIModel} with TensorZero OpenAI-gateway streaming fixes:
 * - usage on the final chunk with `choices` (see {@link splitUsageOntoEmptyChoicesChunk})
 * - `delta.tensorzero_extra_content` thoughts → Strands `reasoningContentDelta` (Hooman “thinking” UI)
 */
export class StrandsTensorZeroModel extends OpenAIModel {
  constructor(options: OpenAIModelOptions) {
    if (options.api !== "chat") {
      throw new Error(
        `TensorZero provider requires api: 'chat' (got '${String(options.api)}')`,
      );
    }
    super(options);
  }

  override async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    if (!messages || messages.length === 0) {
      throw new Error("At least one message is required");
    }
    const { formatChatRequest, mapChatChunkToEvents } =
      await loadOpenAiChatAdapter();
    const client = (this as unknown as { _client: OpenAI })._client;
    const rewrap = (
      this as unknown as { _rewrapError: (e: unknown) => unknown }
    )._rewrapError;

    try {
      const reasoningPerWireAssistant =
        collectReasoningTextPerWireAssistant(messages);
      const messagesForRequest = stripAssistantReasoningBlocks(messages);
      const request = formatChatRequest(
        this.getConfig() as OpenAIChatConfig,
        messagesForRequest,
        options,
      );
      applyKimiReasoningReplayToChatRequest(request, reasoningPerWireAssistant);
      const raw = await client.chat.completions.create(request);
      const stream = splitUsageOntoEmptyChoicesChunk(
        raw as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
      );

      const streamState: TensorZeroStreamState = {
        messageStarted: false,
        textContentBlockStarted: false,
        reasoningContentBlockStarted: false,
      };
      const activeToolCalls = new Map<number, boolean>();
      let bufferedUsage: {
        type: "modelMetadataEvent";
        usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
      } | null = null;

      for await (const chunk of stream) {
        if (!chunk.choices || chunk.choices.length === 0) {
          if (chunk.usage) {
            bufferedUsage = {
              type: "modelMetadataEvent",
              usage: {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: chunk.usage.total_tokens ?? 0,
              },
            };
          }
          continue;
        }

        const delta = chunk.choices[0]?.delta as
          | Record<string, unknown>
          | undefined;
        const prelude = preludeEventsForTensorZeroDelta(delta, streamState);
        const base = mapChatChunkToEvents(chunk, streamState, activeToolCalls);
        const events = injectReasoningStopBeforeMessageStop(
          [...prelude, ...base],
          streamState,
        );

        for (const event of events) {
          if (event.type === "modelMessageStopEvent" && bufferedUsage) {
            yield bufferedUsage;
            bufferedUsage = null;
          }
          yield event;
        }
      }
      if (bufferedUsage) {
        yield bufferedUsage;
      }
    } catch (error) {
      throw rewrap.call(this, error);
    }
  }
}
