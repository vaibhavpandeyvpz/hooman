import {
  ContextWindowOverflowError,
  Model,
  ModelError,
} from "@strands-agents/sdk";
import type { SystemPrompt } from "@strands-agents/sdk";
import type { BaseModelConfig, StreamOptions } from "@strands-agents/sdk";
import {
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
} from "@strands-agents/sdk";
import type { ModelStreamEvent } from "@strands-agents/sdk";
import type { ToolSpec } from "@strands-agents/sdk";
import { Message, ToolResultBlock, ToolUseBlock } from "@strands-agents/sdk";
import type {
  ContentBlock,
  ImageBlock,
  JsonBlock,
  ToolResultContent,
} from "@strands-agents/sdk";
import { Ollama } from "ollama";
import type {
  ChatRequest,
  ChatResponse,
  Message as OllamaMessage,
  Tool as OllamaTool,
} from "ollama";

export interface OllamaModelConfig extends BaseModelConfig {
  modelId?: string;
  /** Ollama server URL (default `http://127.0.0.1:11434` or `OLLAMA_HOST`). */
  host?: string;
  /** Passed through to Ollama `keep_alive`. */
  keepAlive?: string | number;
  /** Merged into Ollama `options` (e.g. num_ctx). */
  options?: Record<string, unknown>;
  /**
   * Ollama `think` flag (controls `message.thinking` on supported models).
   * - **Omitted (`undefined`):** do not send `think` — server default (often streams `thinking`, which we map to
   *   Strands `ReasoningBlock` via `reasoningContentDelta`).
   * - **`false`:** disable the thinking channel; the model puts prose in `content` only (shows up as normal
   *   `TextBlock` in persisted sessions).
   * - **`true` or `"high" | "medium" | "low"`:** force extended thinking at that level.
   */
  think?: boolean | "high" | "medium" | "low";
}

function extractSystemText(system?: SystemPrompt): string | undefined {
  if (system === undefined) {
    return undefined;
  }
  if (typeof system === "string") {
    return system;
  }
  const parts: string[] = [];
  for (const block of system) {
    if (block.type === "textBlock") {
      parts.push(block.text);
    }
  }
  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : undefined;
}

/** One Ollama chat message carrying an image (bytes or URL string). */
function formatImageBlock(
  role: "user" | "assistant" | "tool",
  block: ImageBlock,
): OllamaMessage[] {
  const src = block.source;
  if (src.type === "imageSourceBytes") {
    return [{ role, content: "", images: [src.bytes] }];
  }
  if (src.type === "imageSourceUrl") {
    return [{ role, content: "", images: [src.url] }];
  }
  return [
    {
      role,
      content:
        "(Ollama: image sources other than bytes or URL are not supported for this provider)",
    },
  ];
}

/**
 * Flatten a tool result into one Ollama `role: "tool"` message per content item, matching
 * Python `OllamaModel._format_request_message_contents` for `toolResult` (text, JSON as text,
 * nested images as `images`, etc.).
 */
function formatToolResultContentsToOllama(
  block: ToolResultBlock,
): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  for (const c of block.content) {
    out.push(...formatToolResultContentToOllama(c));
  }
  if (out.length > 0) {
    return out;
  }
  const fallback = block.status === "error" ? "(tool error)" : "";
  return [{ role: "tool", content: fallback }];
}

function formatToolResultContentToOllama(
  c: ToolResultContent,
): OllamaMessage[] {
  if (c.type === "textBlock") {
    return [{ role: "tool", content: c.text }];
  }
  if (c.type === "jsonBlock") {
    const j = c as JsonBlock;
    return [{ role: "tool", content: JSON.stringify(j.json) }];
  }
  if (c.type === "imageBlock") {
    return formatImageBlock("tool", c as ImageBlock);
  }
  if (c.type === "videoBlock" || c.type === "documentBlock") {
    return [
      {
        role: "tool",
        content: `(Ollama: tool result ${c.type} is not supported)`,
      },
    ];
  }
  return [];
}

function formatContentBlock(
  role: "user" | "assistant",
  block: ContentBlock,
): OllamaMessage[] {
  if (block.type === "textBlock") {
    return [{ role, content: block.text }];
  }
  if (block.type === "imageBlock") {
    return formatImageBlock(role, block as ImageBlock);
  }
  if (block.type === "toolUseBlock") {
    const b = block as ToolUseBlock;
    const args =
      typeof b.input === "object" && b.input !== null && !Array.isArray(b.input)
        ? (b.input as Record<string, unknown>)
        : {};
    return [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: b.name,
              arguments: args,
            },
          },
        ],
      },
    ];
  }
  if (block.type === "toolResultBlock") {
    return formatToolResultContentsToOllama(block as ToolResultBlock);
  }
  if (block.type === "reasoningBlock") {
    // Ollama chat history has no structured reasoning part. Re-sending prior turns' chain
    // of thought as plain text would pollute `content` and break separation in persistence — omit.
    return [];
  }
  return [];
}

function strandsMessagesToOllama(
  messages: Message[],
  systemText: string | undefined,
): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (systemText) {
    out.push({ role: "system", content: systemText });
  }
  for (const msg of messages) {
    for (const block of msg.content) {
      out.push(...formatContentBlock(msg.role, block));
    }
  }
  return out;
}

function strandsToolsToOllama(
  toolSpecs: ToolSpec[] | undefined,
): OllamaTool[] | undefined {
  if (!toolSpecs?.length) {
    return undefined;
  }
  return toolSpecs.map(
    (spec) =>
      ({
        type: "function",
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.inputSchema ?? { type: "object", properties: {} },
        },
      }) as OllamaTool,
  );
}

function mapDoneReason(reason: string | undefined): "endTurn" | "maxTokens" {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("length") || r === "max_tokens") {
    return "maxTokens";
  }
  return "endTurn";
}

/** Stable key so we do not re-emit identical `tool_calls` on repeated stream chunks. */
function toolCallsSnapshotKey(
  calls: NonNullable<NonNullable<ChatResponse["message"]>["tool_calls"]>,
): string {
  return JSON.stringify(
    calls.map((tc) => ({
      name: tc.function?.name,
      args: tc.function?.arguments,
    })),
  );
}

export class StrandsOllamaModel extends Model<OllamaModelConfig> {
  private config: OllamaModelConfig;
  private readonly client: Ollama;

  constructor(config: OllamaModelConfig) {
    super();
    this.config = { ...config };
    this.client = new Ollama({
      host:
        this.config.host ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    });
  }

  updateConfig(modelConfig: OllamaModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  getConfig(): OllamaModelConfig {
    return { ...this.config };
  }

  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    const modelId = this.config.modelId;
    if (!modelId) {
      throw new ModelError("Ollama modelId is not configured");
    }

    const systemText = extractSystemText(options?.systemPrompt);
    const ollamaMessages = strandsMessagesToOllama(messages, systemText);
    const tools = strandsToolsToOllama(options?.toolSpecs);

    const request: ChatRequest = {
      model: modelId,
      messages: ollamaMessages,
      stream: true,
      tools,
      options: {
        num_predict: this.config.maxTokens,
        temperature: this.config.temperature,
        top_p: this.config.topP,
        ...(this.config.options ?? {}),
      },
    };
    if (this.config.think !== undefined) {
      request.think = this.config.think;
    }
    if (this.config.keepAlive !== undefined) {
      request.keep_alive = this.config.keepAlive;
    }

    let stream: AsyncIterable<ChatResponse>;
    try {
      stream = await this.client.chat({ ...request, stream: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("context") || msg.includes("token")) {
        throw new ContextWindowOverflowError(msg);
      }
      throw new ModelError(`Ollama chat error: ${msg}`, { cause: e });
    }

    // `message.content` is treated as an incremental fragment per chunk (Ollama / ollama-js).
    // **Tool calls:** many models (e.g. gemma4:e4b) send `tool_calls` only on `done: false` chunks;
    // the final `done: true` line often omits `tool_calls`, so we must not require `part.done`.
    // Emit tools when a new snapshot differs from the last emitted (Strands concatenates tool deltas).
    yield new ModelMessageStartEvent({
      type: "modelMessageStartEvent",
      role: "assistant",
    });

    let last: ChatResponse | undefined;
    let toolRequested = false;
    let textBlockOpen = false;
    let reasoningBlockOpen = false;
    let lastEmittedToolCallsKey: string | undefined;

    for await (const part of stream) {
      last = part;
      const msg = part.message;
      if (!msg) {
        continue;
      }

      const calls = msg.tool_calls;
      if (calls?.length) {
        const snapKey = toolCallsSnapshotKey(calls);
        if (snapKey !== lastEmittedToolCallsKey) {
          lastEmittedToolCallsKey = snapKey;
          toolRequested = true;
          if (reasoningBlockOpen) {
            yield new ModelContentBlockStopEvent({
              type: "modelContentBlockStopEvent",
            });
            reasoningBlockOpen = false;
          }
          if (textBlockOpen) {
            yield new ModelContentBlockStopEvent({
              type: "modelContentBlockStopEvent",
            });
            textBlockOpen = false;
          }
          let toolIndex = 0;
          for (const toolCall of calls) {
            const name = toolCall.function?.name ?? "tool";
            const apiId = (toolCall as { id?: string }).id;
            const toolUseId =
              apiId ?? (calls.length > 1 ? `${name}_${toolIndex}` : name);
            toolIndex += 1;
            const argsRaw = toolCall.function?.arguments;
            const inputStr =
              typeof argsRaw === "string"
                ? argsRaw
                : JSON.stringify(argsRaw ?? {});
            yield new ModelContentBlockStartEvent({
              type: "modelContentBlockStartEvent",
              start: { type: "toolUseStart", name, toolUseId },
            });
            yield new ModelContentBlockDeltaEvent({
              type: "modelContentBlockDeltaEvent",
              delta: {
                type: "toolUseInputDelta",
                input: inputStr,
              },
            });
            yield new ModelContentBlockStopEvent({
              type: "modelContentBlockStopEvent",
            });
          }
        }
      }

      const thinking = (msg as { thinking?: string }).thinking ?? "";
      const content = msg.content ?? "";

      if (thinking.length > 0) {
        if (textBlockOpen) {
          yield new ModelContentBlockStopEvent({
            type: "modelContentBlockStopEvent",
          });
          textBlockOpen = false;
        }
        if (!reasoningBlockOpen) {
          yield new ModelContentBlockStartEvent({
            type: "modelContentBlockStartEvent",
          });
          reasoningBlockOpen = true;
        }
        yield new ModelContentBlockDeltaEvent({
          type: "modelContentBlockDeltaEvent",
          delta: { type: "reasoningContentDelta", text: thinking },
        });
      }

      if (content.length > 0) {
        if (reasoningBlockOpen) {
          yield new ModelContentBlockStopEvent({
            type: "modelContentBlockStopEvent",
          });
          reasoningBlockOpen = false;
        }
        if (!textBlockOpen) {
          yield new ModelContentBlockStartEvent({
            type: "modelContentBlockStartEvent",
          });
          textBlockOpen = true;
        }
        yield new ModelContentBlockDeltaEvent({
          type: "modelContentBlockDeltaEvent",
          delta: { type: "textDelta", text: content },
        });
      }
    }

    if (reasoningBlockOpen) {
      yield new ModelContentBlockStopEvent({
        type: "modelContentBlockStopEvent",
      });
    }
    if (textBlockOpen) {
      yield new ModelContentBlockStopEvent({
        type: "modelContentBlockStopEvent",
      });
    }

    const doneReason = last?.done_reason;
    const stopReason = toolRequested
      ? ("toolUse" as const)
      : mapDoneReason(doneReason);

    yield new ModelMessageStopEvent({
      type: "modelMessageStopEvent",
      stopReason,
    });

    yield new ModelMetadataEvent({
      type: "modelMetadataEvent",
      usage: {
        inputTokens: last?.prompt_eval_count ?? 0,
        outputTokens: last?.eval_count ?? 0,
        totalTokens: (last?.prompt_eval_count ?? 0) + (last?.eval_count ?? 0),
      },
      metrics: last?.total_duration
        ? { latencyMs: last.total_duration / 1_000_000 }
        : undefined,
    });
  }
}
