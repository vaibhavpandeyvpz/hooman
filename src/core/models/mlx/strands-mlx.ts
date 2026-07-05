import { Model, ModelError } from "@strands-agents/sdk";
import type {
  BaseModelConfig,
  ContentBlock,
  Message,
  StreamOptions,
  SystemPrompt,
  ToolSpec,
} from "@strands-agents/sdk";
import {
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
} from "@strands-agents/sdk";
import type { ModelStreamEvent } from "@strands-agents/sdk";
import type { ToolResultBlock, ToolUseBlock } from "@strands-agents/sdk";
import type {
  ChatConfig,
  ChatMessage,
  SessionCapableModel,
  ToolDefinition,
} from "@mlx-node/lm";
import { resolveModelDir } from "./resolve-model.js";

export interface MlxModelConfig extends BaseModelConfig {
  /**
   * Model spec: `owner/repo` Hugging Face repo in MLX format (e.g.
   * `mlx-community/...`) or a local MLX model directory containing
   * `config.json` + safetensors weights.
   */
  modelId?: string;
  /** Hugging Face access token for gated/private repos (falls back to `HF_TOKEN`). */
  hfToken?: string;
  /**
   * Thinking controls. Presence enables reasoning: the model thinks naturally
   * and `effort` caps thought tokens via the runtime's thinking-token budget.
   * Absence disables it (`reasoningEffort: "none"` — the chat template closes
   * the think block immediately and reasoning content is dropped).
   */
  reasoning?: { effort?: "minimal" | "low" | "medium" | "high" };
  /** Cap on thought-segment tokens while reasoning is enabled. */
  thoughtBudgetTokens?: number;
}

/**
 * Loaded MLX models are expensive (weights in unified memory), so share them
 * process-wide keyed by resolved model directory. The native side owns one KV
 * cache per model and serializes turns on a worker thread; each `stream()`
 * call replays the full conversation through `chatStreamSessionStart`, whose
 * `reuseCache` prefix-matching turns the replay into an incremental prefill
 * when the same conversation continues.
 */
const loadedModelPromises = new Map<string, Promise<SessionCapableModel>>();

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

function contentBlockToText(block: ContentBlock): string | undefined {
  if (block.type === "textBlock") {
    return block.text;
  }
  if (
    block.type === "imageBlock" ||
    block.type === "videoBlock" ||
    block.type === "documentBlock"
  ) {
    return `(mlx: ${block.type} content is not supported by this provider)`;
  }
  return undefined;
}

function toolResultToText(block: ToolResultBlock): string {
  const parts: string[] = [];
  for (const c of block.content) {
    if (c.type === "textBlock") {
      parts.push(c.text);
    } else if (c.type === "jsonBlock") {
      parts.push(JSON.stringify(c.json));
    } else if (c.type === "imageBlock") {
      parts.push("(mlx: image tool results are not supported)");
    }
  }
  const joined = parts.join("\n");
  if (joined.length > 0) {
    return joined;
  }
  return block.status === "error" ? "(tool error)" : "";
}

/**
 * Convert Strands conversation history to `@mlx-node/lm` `ChatMessage[]`.
 * Assistant toolUse blocks become `toolCalls` on the assistant message and
 * the matching toolResult blocks (which Strands puts on the following user
 * message) become `role: "tool"` messages referencing the call id — the
 * OpenAI-style layout the mlx-node chat templates expect. Rendering the full
 * history in one pass also sidesteps the ChatSession delta API's
 * one-tool-call-per-turn limit: multi-call fan-outs are resolved atomically
 * in a single jinja render.
 */
function strandsMessagesToHistory(
  messages: Message[],
  systemText: string | undefined,
): ChatMessage[] {
  const history: ChatMessage[] = [];
  if (systemText) {
    history.push({ role: "system", content: systemText });
  }

  const pushText = (role: "user" | "assistant", text: string) => {
    const last = history.at(-1);
    if (last?.role === role && last.toolCalls === undefined) {
      last.content =
        last.content.length > 0 ? `${last.content}\n${text}` : text;
    } else {
      history.push({ role, content: text });
    }
  };

  for (const msg of messages) {
    for (const block of msg.content) {
      if (msg.role === "assistant") {
        if (block.type === "toolUseBlock") {
          const b = block as ToolUseBlock;
          const call = {
            id: b.toolUseId,
            name: b.name,
            arguments: JSON.stringify(b.input ?? {}),
          };
          const last = history.at(-1);
          if (last?.role === "assistant") {
            last.toolCalls = [...(last.toolCalls ?? []), call];
          } else {
            history.push({ role: "assistant", content: "", toolCalls: [call] });
          }
          continue;
        }
        if (block.type === "reasoningBlock") {
          // Prior turns' chain of thought is not replayed into the context.
          continue;
        }
        const text = contentBlockToText(block);
        if (text !== undefined && text.length > 0) {
          const last = history.at(-1);
          if (last?.role === "assistant") {
            last.content =
              last.content.length > 0 ? `${last.content}\n${text}` : text;
          } else {
            history.push({ role: "assistant", content: text });
          }
        }
        continue;
      }
      // user role
      if (block.type === "toolResultBlock") {
        const b = block as ToolResultBlock;
        history.push({
          role: "tool",
          content: toolResultToText(b),
          toolCallId: b.toolUseId,
        });
        continue;
      }
      const text = contentBlockToText(block);
      if (text !== undefined && text.length > 0) {
        pushText("user", text);
      }
    }
  }
  return history;
}

/**
 * Convert Strands tool specs to mlx-node `ToolDefinition`s. The native layer
 * cannot take nested objects across NAPI, so `parameters.properties` is a
 * JSON string (same conversion `createToolDefinition` performs).
 */
function strandsToolsToDefinitions(
  toolSpecs: ToolSpec[] | undefined,
): ToolDefinition[] | undefined {
  if (!toolSpecs?.length) {
    return undefined;
  }
  return toolSpecs.map((spec) => {
    const schema = (spec.inputSchema ?? {}) as {
      properties?: Record<string, unknown>;
      required?: unknown;
    };
    const properties = schema.properties;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((r): r is string => typeof r === "string")
      : undefined;
    return {
      type: "function",
      function: {
        name: spec.name,
        ...(spec.description ? { description: spec.description } : {}),
        ...(properties
          ? {
              parameters: {
                type: "object",
                properties: JSON.stringify(properties),
                ...(required ? { required } : {}),
              },
            }
          : {}),
      },
    } satisfies ToolDefinition;
  });
}

/**
 * The native decode loop classifies each delta with `isReasoning`, but the
 * thought-marker tokens themselves (`<think>` / `</think>`) are streamed as
 * reasoning deltas too (the final event's `thinking` field is tag-stripped —
 * only the incremental stream carries them). Strip them so the reasoning
 * block contains just the chain of thought.
 */
const THINK_MARKER_RE = /<\/?think>/g;

/** Strands {@link Model} backed by in-process Apple MLX via `@mlx-node/lm`. */
export class StrandsMlxModel extends Model<MlxModelConfig> {
  private config: MlxModelConfig;
  private modelPromise: Promise<SessionCapableModel> | undefined;

  constructor(config: MlxModelConfig) {
    super();
    this.config = { ...config };
  }

  updateConfig(modelConfig: MlxModelConfig): void {
    const modelKey = (c: MlxModelConfig) => JSON.stringify([c.modelId]);
    const before = modelKey(this.config);
    this.config = { ...this.config, ...modelConfig };
    if (modelKey(this.config) !== before) {
      // Weights stay cached process-wide; just re-resolve on the next stream.
      this.modelPromise = undefined;
    }
  }

  getConfig(): MlxModelConfig {
    return { ...this.config };
  }

  private getModel(): Promise<SessionCapableModel> {
    this.modelPromise ??= this.initModel();
    return this.modelPromise;
  }

  private async initModel(): Promise<SessionCapableModel> {
    const modelId = this.config.modelId;
    if (!modelId) {
      throw new ModelError("MLX model is not configured");
    }
    const modelDir = await resolveModelDir(modelId, this.config.hfToken);
    let promise = loadedModelPromises.get(modelDir);
    if (!promise) {
      promise = (async () => {
        const { loadModel } = await import("@mlx-node/lm");
        const loaded = await loadModel(modelDir);
        if (
          typeof (loaded as Partial<SessionCapableModel>)
            .chatStreamSessionStart !== "function"
        ) {
          throw new Error(
            `MLX model "${modelId}" is not a chat-capable model ` +
              `(embedding/OCR models cannot be used as an LLM provider).`,
          );
        }
        return loaded as unknown as SessionCapableModel;
      })();
      loadedModelPromises.set(modelDir, promise);
      promise.catch(() => loadedModelPromises.delete(modelDir));
    }
    return promise;
  }

  private buildChatConfig(toolSpecs: ToolSpec[] | undefined): ChatConfig {
    const reasoningEnabled = this.config.reasoning !== undefined;
    const tools = strandsToolsToDefinitions(toolSpecs);
    return {
      // Presence of `reasoning` lets the model think naturally with a token
      // budget; absence sets "none" so the template closes the think block
      // immediately and reasoning content is omitted from the output.
      ...(reasoningEnabled
        ? this.config.thoughtBudgetTokens !== undefined
          ? { thinkingTokenBudget: this.config.thoughtBudgetTokens }
          : {}
        : { reasoningEffort: "none" }),
      ...(tools ? { tools } : {}),
      ...(this.config.maxTokens !== undefined
        ? { maxNewTokens: this.config.maxTokens }
        : {}),
      ...(this.config.temperature !== undefined
        ? { temperature: this.config.temperature }
        : {}),
      ...(this.config.topP !== undefined ? { topP: this.config.topP } : {}),
      reuseCache: true,
    };
  }

  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    let model: SessionCapableModel;
    try {
      model = await this.getModel();
    } catch (e) {
      // Let a failed init (bad model spec, download failure) be retried.
      this.modelPromise = undefined;
      if (e instanceof ModelError) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new ModelError(`MLX initialization failed: ${msg}`, { cause: e });
    }

    const systemText = extractSystemText(options?.systemPrompt);
    const history = strandsMessagesToHistory(messages, systemText);
    const last = history.at(-1);
    if (last === undefined || (last.role !== "user" && last.role !== "tool")) {
      // The native session API generates against a trailing user/tool turn.
      history.push({ role: "user", content: "" });
    }
    const chatConfig = this.buildChatConfig(options?.toolSpecs);

    yield new ModelMessageStartEvent({
      type: "modelMessageStartEvent",
      role: "assistant",
    });

    let textBlockOpen = false;
    let reasoningBlockOpen = false;
    const closeOpenBlock = (): ModelStreamEvent | undefined => {
      if (textBlockOpen || reasoningBlockOpen) {
        textBlockOpen = false;
        reasoningBlockOpen = false;
        return new ModelContentBlockStopEvent({
          type: "modelContentBlockStopEvent",
        });
      }
      return undefined;
    };

    try {
      for await (const event of model.chatStreamSessionStart(
        history,
        chatConfig,
      )) {
        if (!event.done) {
          const isReasoning = event.isReasoning === true;
          const text = isReasoning
            ? event.text.replace(THINK_MARKER_RE, "")
            : event.text;
          if (text.length === 0) {
            continue;
          }
          // The template emits a newline right after `<think>`; don't open
          // the reasoning block on whitespace alone.
          if (isReasoning && !reasoningBlockOpen && text.trim().length === 0) {
            continue;
          }
          if (isReasoning ? textBlockOpen : reasoningBlockOpen) {
            const stop = closeOpenBlock();
            if (stop) {
              yield stop;
            }
          }
          if (!textBlockOpen && !reasoningBlockOpen) {
            yield new ModelContentBlockStartEvent({
              type: "modelContentBlockStartEvent",
            });
            if (isReasoning) {
              reasoningBlockOpen = true;
            } else {
              textBlockOpen = true;
            }
          }
          yield new ModelContentBlockDeltaEvent({
            type: "modelContentBlockDeltaEvent",
            delta: isReasoning
              ? { type: "reasoningContentDelta", text }
              : { type: "textDelta", text },
          });
          continue;
        }

        // Final event.
        const stop = closeOpenBlock();
        if (stop) {
          yield stop;
        }
        if (event.finishReason === "error") {
          throw new ModelError(
            `MLX generation finished with an error${
              event.rawText ? `: ${event.rawText.slice(-500)}` : ""
            }`,
          );
        }

        const okCalls = (event.toolCalls ?? []).filter(
          (call) => call.status === "ok",
        );
        for (const call of okCalls) {
          const args =
            typeof call.arguments === "string" ? {} : (call.arguments ?? {});
          yield new ModelContentBlockStartEvent({
            type: "modelContentBlockStartEvent",
            start: {
              type: "toolUseStart",
              name: call.name,
              toolUseId: call.id,
            },
          });
          yield new ModelContentBlockDeltaEvent({
            type: "modelContentBlockDeltaEvent",
            delta: {
              type: "toolUseInputDelta",
              input: JSON.stringify(args),
            },
          });
          yield new ModelContentBlockStopEvent({
            type: "modelContentBlockStopEvent",
          });
        }

        const stopReason =
          okCalls.length > 0
            ? ("toolUse" as const)
            : event.finishReason === "length" ||
                event.finishReason === "max_tokens"
              ? ("maxTokens" as const)
              : ("endTurn" as const);
        yield new ModelMessageStopEvent({
          type: "modelMessageStopEvent",
          stopReason,
        });

        const inputTokens = event.promptTokens ?? 0;
        const outputTokens = event.numTokens ?? 0;
        yield new ModelMetadataEvent({
          type: "modelMetadataEvent",
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
        });
      }
    } catch (e) {
      if (e instanceof ModelError) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new ModelError(`MLX generation error: ${msg}`, { cause: e });
    }
  }
}
