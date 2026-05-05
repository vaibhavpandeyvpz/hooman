import {
  ContextWindowOverflowError,
  ModelThrottledError,
} from "@strands-agents/sdk";
import type { Message } from "@strands-agents/sdk";
import type { StreamOptions } from "@strands-agents/sdk";
import type { ModelStreamEvent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import OpenAI from "openai";
import { splitUsageOntoEmptyChoicesChunk } from "../openai/openai-stream-shims.js";

const CONTEXT_OVERFLOW_PATTERNS = [
  "maximum context length",
  "context_length_exceeded",
  "too many tokens",
  "context length",
] as const;

const RATE_LIMIT_PATTERNS = [
  "rate_limit_exceeded",
  "rate limit",
  "too many requests",
] as const;

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
    const self = this as unknown as {
      _formatRequest: (
        messages: Message[],
        options?: StreamOptions,
      ) => OpenAI.Chat.ChatCompletionCreateParamsStreaming;
      _client: OpenAI;
      _mapOpenAIChunkToSDKEvents: (
        chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
        streamState: {
          messageStarted: boolean;
          textContentBlockStarted: boolean;
        },
        activeToolCalls: Map<number, boolean>,
      ) => ModelStreamEvent[];
    };
    try {
      const request = self._formatRequest(messages, options);
      const raw = await self._client.chat.completions.create(request);
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
        const base = self._mapOpenAIChunkToSDKEvents(
          chunk,
          streamState,
          activeToolCalls,
        );
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
      const err = error as Error & { status?: number; code?: string };
      if (
        err.status === 429 ||
        err.code === "rate_limit_exceeded" ||
        RATE_LIMIT_PATTERNS.some((p) => err.message?.toLowerCase().includes(p))
      ) {
        const message =
          err.message ?? "Request was throttled by the model provider";
        throw new ModelThrottledError(message, { cause: err });
      }
      if (
        CONTEXT_OVERFLOW_PATTERNS.some((p) =>
          err.message?.toLowerCase().includes(p),
        )
      ) {
        throw new ContextWindowOverflowError(err.message);
      }
      throw error;
    }
  }
}
