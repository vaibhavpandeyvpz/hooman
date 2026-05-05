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
  applyKimiReasoningContentToChatRequest,
  collectReasoningTextPerWireAssistant,
  stripAssistantReasoningBlocks,
} from "../openai/kimi-reasoning-wire.js";
import { splitUsageOntoEmptyChoicesChunk } from "../openai/openai-stream-shims.js";

/** Strands 1.x chat adapter lives next to `models/openai` and is not a package export. */
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

type BifrostStreamState = {
  messageStarted: boolean;
  textContentBlockStarted: boolean;
  reasoningContentBlockStarted: boolean;
};

/** Bifrost/Moonshot streams may omit `delta.role`; Strands requires it for a valid turn. */
function ensureAssistantRoleOnFirstDelta(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  injected: { value: boolean },
): void {
  if (injected.value || !chunk.choices?.length) {
    return;
  }
  const delta = chunk.choices[0]?.delta as Record<string, unknown> | undefined;
  if (!delta || typeof delta !== "object") {
    return;
  }
  if (delta.role != null && delta.role !== "") {
    injected.value = true;
    return;
  }
  const meaningful = Object.keys(delta).some((k) => {
    const v = delta[k];
    if (v == null) {
      return false;
    }
    if (k === "content" || k === "reasoning") {
      return typeof v === "string" && v.length > 0;
    }
    if (k === "tool_calls") {
      return Array.isArray(v) && v.length > 0;
    }
    if (k === "reasoning_details") {
      return Array.isArray(v) && v.length > 0;
    }
    return true;
  });
  if (!meaningful) {
    return;
  }
  delta.role = "assistant";
  injected.value = true;
}

function closeOpenReasoningBeforeWireEvents(
  delta: Record<string, unknown> | undefined,
  streamState: BifrostStreamState,
): ModelStreamEvent[] {
  if (!delta || !streamState.reasoningContentBlockStarted) {
    return [];
  }
  const toolCalls = delta.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    streamState.reasoningContentBlockStarted = false;
    return [{ type: "modelContentBlockStopEvent" }];
  }
  const content = delta.content;
  if (typeof content === "string" && content.length > 0) {
    streamState.reasoningContentBlockStarted = false;
    return [{ type: "modelContentBlockStopEvent" }];
  }
  return [];
}

function openReasoningDeltaEvents(
  delta: Record<string, unknown> | undefined,
  streamState: BifrostStreamState,
): ModelStreamEvent[] {
  const out: ModelStreamEvent[] = [];
  if (!delta) {
    return out;
  }
  const reasoning = delta.reasoning;
  if (typeof reasoning !== "string" || reasoning.length === 0) {
    return out;
  }
  if (!streamState.reasoningContentBlockStarted) {
    out.push({ type: "modelContentBlockStartEvent" });
    streamState.reasoningContentBlockStarted = true;
  }
  out.push({
    type: "modelContentBlockDeltaEvent",
    delta: { type: "reasoningContentDelta", text: reasoning },
  });
  return out;
}

function injectReasoningStopBeforeMessageStop(
  events: ModelStreamEvent[],
  streamState: BifrostStreamState,
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
 * {@link OpenAIModel} tuned for Bifrost (and similar gateways) fronting Moonshot/Kimi OpenAI
 * routes: `delta.reasoning`, missing initial `delta.role`, `reasoning_content` replay for tool
 * turns, and usage on the final streamed chunk.
 */
export class StrandsBifrostModel extends OpenAIModel {
  constructor(options: OpenAIModelOptions) {
    if (options.api !== "chat") {
      throw new Error(
        `Bifrost provider requires api: 'chat' (got '${String(options.api)}')`,
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
      applyKimiReasoningContentToChatRequest(
        request,
        reasoningPerWireAssistant,
        { toolPlaceholderWhenMissingReasoning: true },
      );
      const raw = await client.chat.completions.create(request);
      const stream = splitUsageOntoEmptyChoicesChunk(
        raw as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
      );

      const streamState: BifrostStreamState = {
        messageStarted: false,
        textContentBlockStarted: false,
        reasoningContentBlockStarted: false,
      };
      const activeToolCalls = new Map<number, boolean>();
      const roleInjected = { value: false };
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

        ensureAssistantRoleOnFirstDelta(chunk, roleInjected);

        const delta = chunk.choices[0]?.delta as
          | Record<string, unknown>
          | undefined;

        const closeReasoning = closeOpenReasoningBeforeWireEvents(
          delta,
          streamState,
        );
        const base = mapChatChunkToEvents(chunk, streamState, activeToolCalls);
        const openReasoning = openReasoningDeltaEvents(delta, streamState);
        const events = injectReasoningStopBeforeMessageStop(
          [...closeReasoning, ...base, ...openReasoning],
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
