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
  JsChatMessage,
  JsGenerateOptions,
  JsGenerateResult,
  JsToken,
  JsTool,
  MlexModel,
} from "mlex.js";
import { resolveModelDir } from "./resolve-model.js";
import type { MlxPromptCacheConfig } from "../types.js";

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
   * Whether turns may reuse KV state from mlex's internal prompt-cache pool
   * (prefix matching against previous calls), applied once when the model
   * is loaded. `undefined`/`false` disables caching entirely (every
   * generate call forwards `promptCache: false`); an object (even `{}`)
   * enables it, with its fields overriding mlex's own pool-sizing defaults.
   */
  promptCache?: MlxPromptCacheConfig | false;
  /**
   * Thinking controls. Presence enables reasoning (`enableThinking: true` on
   * the chat template) with `effort` capping the reasoning span via
   * `reasoningBudgetTokens`. Absence disables it: the template renders with
   * thinking off and reasoning content is dropped.
   */
  reasoning?: { effort?: "minimal" | "low" | "medium" | "high" };
  /** Cap on reasoning-span tokens while thinking is enabled. */
  thoughtBudgetTokens?: number;
}

/**
 * mlex.js caps generation at 256 tokens when `maxTokens` is unset — far too
 * low for agent turns — so apply our own default instead.
 */
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Loaded MLX models are expensive (weights in unified memory), so share them
 * process-wide keyed by resolved model directory. mlex.js is stateless like
 * the OpenAI/Anthropic APIs — every `generate` call takes the full
 * transcript, and an internal prompt-cache pool transparently reuses KV
 * state for whatever prefix a previous call already computed.
 */
const loadedModelPromises = new Map<string, Promise<MlexModel>>();

/**
 * Streamed token classification is best-effort at token granularity, so the
 * reasoning-span markers themselves (`<think>`/`</think>`, Gemma4's channel
 * markers) can arrive inside `kind: "reasoning"` deltas. The final result's
 * `reasoning` field is marker-stripped — only the incremental stream carries
 * them — so strip them here to keep the reasoning block to the chain of
 * thought.
 */
const REASONING_MARKER_RE = /<\/?think>|<\|channel\|?>thought|<\/?channel\|>/g;

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
 * Convert Strands conversation history to mlex.js `JsChatMessage[]` — the
 * same OpenAI-style layout: assistant toolUse blocks become `toolCalls` on
 * the assistant message and the matching toolResult blocks (which Strands
 * puts on the following user message) become `role: "tool"` messages
 * referencing the call id. Image blocks with inline bytes are attached as
 * `images` when the loaded checkpoint accepts them.
 */
function strandsMessagesToHistory(
  messages: Message[],
  systemText: string | undefined,
  supportsImages: boolean,
): JsChatMessage[] {
  const history: JsChatMessage[] = [];
  if (systemText) {
    history.push({ role: "system", content: systemText });
  }

  const appendText = (msg: JsChatMessage, text: string) => {
    msg.content = msg.content.length > 0 ? `${msg.content}\n${text}` : text;
  };

  const blockToText = (block: ContentBlock): string | undefined => {
    if (block.type === "textBlock") {
      return block.text;
    }
    if (
      block.type === "imageBlock" ||
      block.type === "videoBlock" ||
      block.type === "documentBlock"
    ) {
      return `(mlx: ${block.type} content is not supported by this model)`;
    }
    return undefined;
  };

  for (const msg of messages) {
    for (const block of msg.content) {
      if (msg.role === "assistant") {
        if (block.type === "toolUseBlock") {
          const b = block as ToolUseBlock;
          const call = {
            id: b.toolUseId,
            name: b.name,
            argumentsJson: JSON.stringify(b.input ?? {}),
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
        const text = blockToText(block);
        if (text !== undefined && text.length > 0) {
          const last = history.at(-1);
          if (last?.role === "assistant") {
            appendText(last, text);
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
      if (block.type === "imageBlock" && supportsImages) {
        const source = block.source as { bytes?: Uint8Array };
        if (source.bytes !== undefined) {
          const last = history.at(-1);
          const target =
            last?.role === "user" && last.toolCalls === undefined
              ? last
              : (history.push({ role: "user", content: "" }),
                history.at(-1)!);
          target.images = [...(target.images ?? []), Buffer.from(source.bytes)];
          continue;
        }
      }
      const text = blockToText(block);
      if (text !== undefined && text.length > 0) {
        const last = history.at(-1);
        if (last?.role === "user" && last.toolCalls === undefined) {
          appendText(last, text);
        } else {
          history.push({ role: "user", content: text });
        }
      }
    }
  }
  return history;
}

/**
 * Convert Strands tool specs to mlex.js `JsTool`s. mlex takes standard JSON
 * Schema `parameters` directly — no GBNF conversion or schema mangling.
 */
function strandsToolsToDefinitions(
  toolSpecs: ToolSpec[] | undefined,
): JsTool[] | undefined {
  if (!toolSpecs?.length) {
    return undefined;
  }
  return toolSpecs.map((spec) => ({
    name: spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    parameters: spec.inputSchema ?? { type: "object", properties: {} },
  }));
}

type StreamQueueItem =
  | { token: JsToken }
  | { result: JsGenerateResult }
  | { error: unknown };

/** Strands {@link Model} backed by in-process Apple MLX via `mlex.js`. */
export class StrandsMlxModel extends Model<MlxModelConfig> {
  private config: MlxModelConfig;
  private modelPromise: Promise<MlexModel> | undefined;

  constructor(config: MlxModelConfig) {
    super();
    this.config = { ...config };
  }

  updateConfig(modelConfig: MlxModelConfig): void {
    const modelKey = (c: MlxModelConfig) =>
      JSON.stringify([c.modelId, c.promptCache ?? null]);
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

  private getModel(): Promise<MlexModel> {
    this.modelPromise ??= this.initModel();
    return this.modelPromise;
  }

  private async initModel(): Promise<MlexModel> {
    const modelId = this.config.modelId;
    if (!modelId) {
      throw new ModelError("MLX model is not configured");
    }
    const modelDir = await resolveModelDir(modelId, this.config.hfToken);
    const promptCache = this.config.promptCache;
    const cacheEnabled = promptCache !== undefined && promptCache !== false;
    // The prompt-cache pool is sized once at load time; key the shared
    // instance by pool config too so two provider configs pointing at the
    // same model directory with different sizing each get their own
    // session instead of silently reusing whichever loaded first.
    const cacheKey = `${modelDir}\u0000${JSON.stringify(cacheEnabled ? promptCache : false)}`;
    let promise = loadedModelPromises.get(cacheKey);
    if (!promise) {
      promise = (async () => {
        const { MlexModel } = await import("mlex.js");
        return MlexModel.load(
          modelDir,
          cacheEnabled
            ? {
                ...(promptCache.maxEntries !== undefined
                  ? { maxEntries: promptCache.maxEntries }
                  : {}),
                ...(promptCache.ttl !== undefined
                  ? { ttlSeconds: promptCache.ttl }
                  : {}),
                ...(promptCache.minTokens !== undefined
                  ? { minCacheableTokens: promptCache.minTokens }
                  : {}),
              }
            : undefined,
        );
      })();
      loadedModelPromises.set(cacheKey, promise);
      promise.catch(() => loadedModelPromises.delete(cacheKey));
    }
    return promise;
  }

  private buildGenerateOptions(
    toolSpecs: ToolSpec[] | undefined,
  ): JsGenerateOptions {
    const reasoningEnabled = this.config.reasoning !== undefined;
    const tools = strandsToolsToDefinitions(toolSpecs);
    return {
      maxTokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(this.config.temperature !== undefined
        ? { temperature: this.config.temperature }
        : {}),
      ...(this.config.topP !== undefined ? { topP: this.config.topP } : {}),
      ...(tools ? { tools } : {}),
      ...(this.config.promptCache === undefined || this.config.promptCache === false
        ? { promptCache: false }
        : {}),
      // Presence of `reasoning` opts into thinking with a token budget;
      // absence pins it off (the template default for every supported
      // family, made explicit).
      enableThinking: reasoningEnabled,
      ...(reasoningEnabled && this.config.thoughtBudgetTokens !== undefined
        ? { reasoningBudgetTokens: this.config.thoughtBudgetTokens }
        : {}),
    };
  }

  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    let model: MlexModel;
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
    const history = strandsMessagesToHistory(
      messages,
      systemText,
      model.supportsImages(),
    );
    const generateOptions = this.buildGenerateOptions(options?.toolSpecs);

    // Adapt mlex's onToken callback + result promise to a pull-based queue
    // the generator below can drain with backpressure-free yields.
    const queue: StreamQueueItem[] = [];
    let notify: (() => void) | undefined;
    const push = (item: StreamQueueItem) => {
      queue.push(item);
      notify?.();
      notify = undefined;
    };
    const waitForItem = () =>
      queue.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            notify = resolve;
          });

    model
      .generate(history, generateOptions, (err, token) => {
        if (err) {
          push({ error: err });
        } else {
          push({ token });
        }
      })
      .then(
        (result) => push({ result }),
        (error: unknown) => push({ error }),
      );

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
      let finalResult: JsGenerateResult | undefined;
      while (finalResult === undefined) {
        await waitForItem();
        while (queue.length > 0 && finalResult === undefined) {
          const item = queue.shift()!;
          if ("error" in item) {
            const e = item.error;
            const msg = e instanceof Error ? e.message : String(e);
            throw new ModelError(`MLX generation error: ${msg}`, { cause: e });
          }
          if ("result" in item) {
            finalResult = item.result;
            break;
          }
          const token = item.token;
          if (token.kind === "toolCall") {
            // Raw, not-yet-parsed tool-call syntax; the parsed calls arrive
            // on the final result.
            continue;
          }
          const isReasoning = token.kind === "reasoning";
          const text = isReasoning
            ? token.text.replace(REASONING_MARKER_RE, "")
            : token.text;
          if (text.length === 0) {
            continue;
          }
          // Templates emit a newline right after the thinking marker; don't
          // open the reasoning block on whitespace alone.
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
        }
      }

      const stop = closeOpenBlock();
      if (stop) {
        yield stop;
      }

      for (const call of finalResult.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.argumentsJson) ?? {};
        } catch {
          // Unparseable arguments degrade to an empty object; the tool's own
          // schema validation will surface the problem to the model.
        }
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
            input: JSON.stringify(input),
          },
        });
        yield new ModelContentBlockStopEvent({
          type: "modelContentBlockStopEvent",
        });
      }

      // Native finish reason from mlex ("stop" | "length" | "toolCalls" |
      // "aborted"), mapped onto Strands' stop reasons. "aborted" (the
      // onToken callback stopped generation early — unused by this
      // provider) degrades to endTurn.
      const stopReason =
        finalResult.finishReason === "toolCalls"
          ? ("toolUse" as const)
          : finalResult.finishReason === "length"
            ? ("maxTokens" as const)
            : ("endTurn" as const);
      yield new ModelMessageStopEvent({
        type: "modelMessageStopEvent",
        stopReason,
      });

      // mlex reports OpenAI-style usage: `promptTokens` is the full prompt
      // and `cachedTokens` a subset of it served from the prompt-cache pool.
      // The factory marks this model total-inclusive so billing meters
      // normalize it to the additive shape.
      const { promptTokens, cachedTokens, completionTokens } =
        finalResult.usage;
      yield new ModelMetadataEvent({
        type: "modelMetadataEvent",
        usage: {
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          totalTokens: promptTokens + completionTokens,
          ...(cachedTokens > 0 ? { cacheReadInputTokens: cachedTokens } : {}),
        },
      });
    } catch (e) {
      if (e instanceof ModelError) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new ModelError(`MLX generation error: ${msg}`, { cause: e });
    }
  }
}
