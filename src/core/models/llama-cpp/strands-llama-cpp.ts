import {
  ContextWindowOverflowError,
  Model,
  ModelError,
} from "@strands-agents/sdk";
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
  ChatHistoryItem,
  ChatModelFunctionCall,
  ChatModelFunctions,
  ChatModelResponse,
  Llama,
  LlamaChat,
  LlamaContext,
  LlamaModel,
} from "node-llama-cpp";
import { jsonSchemaToGbnf, pruneOptionalNulls } from "./gbnf-schema.js";
import { resolveModelFile } from "./resolve-model.js";

export interface LlamaCppModelConfig extends BaseModelConfig {
  /**
   * Model spec: local `.gguf` path, `owner/repo` Hugging Face repo (GGUF file
   * auto-detected), or `owner/repo/path/to/file.gguf`.
   */
  modelId?: string;
  /** Hugging Face access token for gated/private repos (falls back to `HF_TOKEN`). */
  hfToken?: string;
  /** GPU backend forwarded to `getLlama` (default `"auto"`). `false` = CPU only. */
  gpu?: "auto" | "metal" | "cuda" | "vulkan" | false;
  /** Context size in tokens (default: adapted to the model and free VRAM/RAM). */
  context?: number;
  /**
   * Whether turns may reuse the context sequence's KV state evaluated by a
   * previous turn (default `true`). `false` clears the sequence before each
   * generation, re-prefilling the full conversation from scratch.
   */
  promptCache?: boolean;
  /**
   * Thinking controls. Presence enables reasoning: the resolved chat wrapper is
   * configured to allow thought segments (Qwen `thoughts: "auto"`, Gemma 4
   * `reasoning: true`, Harmony `reasoningEffort` mapped from `effort`). Absence
   * disables it: wrappers are told to discourage thoughts and the thought-token
   * budget is forced to `0` so stray thought segments are closed immediately.
   */
  reasoning?: { effort?: "minimal" | "low" | "medium" | "high" };
  /** Cap on thought-segment tokens while reasoning is enabled. */
  thoughtBudgetTokens?: number;
}

/**
 * Loaded llama.cpp runtimes are expensive (weights in RAM/VRAM), so share them
 * process-wide keyed by resolved GGUF path. Contexts stay per Strands model
 * instance so concurrent agents (e.g. subagents) get independent sequences.
 */
const llamaRuntimePromises = new Map<string, Promise<Llama>>();
const loadedModelPromises = new Map<string, Promise<LlamaModel>>();

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
  if (block.type === "imageBlock") {
    return "(llama.cpp: image content is not supported by this provider)";
  }
  if (block.type === "videoBlock" || block.type === "documentBlock") {
    return `(llama.cpp: ${block.type} content is not supported by this provider)`;
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
      parts.push("(llama.cpp: image tool results are not supported)");
    }
  }
  const joined = parts.join("\n");
  if (joined.length > 0) {
    return joined;
  }
  return block.status === "error" ? "(tool error)" : "";
}

/**
 * Convert Strands conversation history to node-llama-cpp `ChatHistoryItem[]`.
 * Tool calls are paired with their results (`ChatModelFunctionCall` requires
 * both) by `toolUseId`: the toolUse blocks live on assistant messages and the
 * matching toolResult blocks on the following user message, so results are
 * folded back into the preceding model response.
 */
function strandsMessagesToHistory(
  messages: Message[],
  systemText: string | undefined,
): ChatHistoryItem[] {
  const history: ChatHistoryItem[] = [];
  if (systemText) {
    history.push({ type: "system", text: systemText });
  }
  const pendingToolUses = new Map<string, ToolUseBlock>();

  const lastModelResponse = (): ChatModelResponse => {
    const last = history.at(-1);
    if (last?.type === "model") {
      return last;
    }
    const created: ChatModelResponse = { type: "model", response: [] };
    history.push(created);
    return created;
  };

  const pushUserText = (text: string) => {
    const last = history.at(-1);
    if (last?.type === "user") {
      last.text = last.text.length > 0 ? `${last.text}\n${text}` : text;
    } else {
      history.push({ type: "user", text });
    }
  };

  for (const msg of messages) {
    for (const block of msg.content) {
      if (msg.role === "assistant") {
        if (block.type === "toolUseBlock") {
          const b = block as ToolUseBlock;
          pendingToolUses.set(b.toolUseId, b);
          continue;
        }
        if (block.type === "reasoningBlock") {
          // Prior turns' chain of thought is not replayed into the context.
          continue;
        }
        const text = contentBlockToText(block);
        if (text !== undefined && text.length > 0) {
          lastModelResponse().response.push(text);
        }
        continue;
      }
      // user role
      if (block.type === "toolResultBlock") {
        const b = block as ToolResultBlock;
        const use = pendingToolUses.get(b.toolUseId);
        pendingToolUses.delete(b.toolUseId);
        const call: ChatModelFunctionCall = {
          type: "functionCall",
          name: use?.name ?? b.toolUseId,
          params: use?.input ?? {},
          result: toolResultToText(b),
        };
        const model = lastModelResponse();
        if (
          model.response.filter((item) => typeof item !== "string").length === 0
        ) {
          call.startsNewChunk = true;
        }
        model.response.push(call);
        continue;
      }
      const text = contentBlockToText(block);
      if (text !== undefined && text.length > 0) {
        pushUserText(text);
      }
    }
  }
  return history;
}

/**
 * Convert Strands tool specs to node-llama-cpp function definitions. Tool
 * inputSchemas are standard JSON Schema (Strands emits them via
 * `z.toJSONSchema`), while node-llama-cpp only accepts its GBNF subset —
 * passing e.g. `anyOf` through unconverted fails generation with
 * `Unknown immutable type undefined`. See `gbnf-schema.ts`.
 */
function strandsToolsToFunctions(
  toolSpecs: ToolSpec[] | undefined,
): ChatModelFunctions | undefined {
  if (!toolSpecs?.length) {
    return undefined;
  }
  const functions: Record<string, { description?: string; params?: object }> =
    {};
  for (const spec of toolSpecs) {
    functions[spec.name] = {
      ...(spec.description ? { description: spec.description } : {}),
      ...(spec.inputSchema
        ? { params: jsonSchemaToGbnf(spec.inputSchema) }
        : {}),
    };
  }
  return functions as ChatModelFunctions;
}

/** Strands {@link Model} backed by in-process llama.cpp via `node-llama-cpp`. */
export class StrandsLlamaCppModel extends Model<LlamaCppModelConfig> {
  private config: LlamaCppModelConfig;
  private chatPromise: Promise<LlamaChat> | undefined;
  private context: LlamaContext | undefined;

  constructor(config: LlamaCppModelConfig) {
    super();
    this.config = { ...config };
  }

  updateConfig(modelConfig: LlamaCppModelConfig): void {
    const chatKey = (c: LlamaCppModelConfig) =>
      JSON.stringify([c.modelId, c.gpu, c.context, c.reasoning ?? null]);
    const before = chatKey(this.config);
    this.config = { ...this.config, ...modelConfig };
    if (chatKey(this.config) !== before) {
      // The chat wrapper bakes in reasoning settings and the context bakes in
      // its size, so drop the lazily-built chat/context and rebuild on the
      // next stream call (loaded weights are cached process-wide).
      this.chatPromise = undefined;
      this.context = undefined;
    }
  }

  getConfig(): LlamaCppModelConfig {
    return { ...this.config };
  }

  private getChat(): Promise<LlamaChat> {
    this.chatPromise ??= this.initChat();
    return this.chatPromise;
  }

  private async initChat(): Promise<LlamaChat> {
    const modelId = this.config.modelId;
    if (!modelId) {
      throw new ModelError("llama.cpp model is not configured");
    }
    const { getLlama, LlamaChat, LlamaLogLevel, resolveChatWrapper } =
      await import("node-llama-cpp");
    const modelPath = await resolveModelFile(modelId, this.config.hfToken);
    const gpu = this.config.gpu ?? "auto";
    const runtimeKey = JSON.stringify(gpu);
    let llamaPromise = llamaRuntimePromises.get(runtimeKey);
    if (!llamaPromise) {
      // Keep llama.cpp's native logging out of the TUI transcript.
      llamaPromise = getLlama({ gpu, logLevel: LlamaLogLevel.error });
      llamaRuntimePromises.set(runtimeKey, llamaPromise);
    }
    const llama = await llamaPromise;
    let modelPromise = loadedModelPromises.get(modelPath);
    if (!modelPromise) {
      modelPromise = llama.loadModel({ modelPath });
      loadedModelPromises.set(modelPath, modelPromise);
    }
    const model = await modelPromise;
    this.context = await model.createContext({
      ...(this.config.context !== undefined
        ? { contextSize: this.config.context }
        : {}),
    });
    // Reasoning on/off lives in the chat template, so resolve the wrapper
    // explicitly (same auto-detection LlamaChat would do) with per-wrapper
    // thinking settings derived from the shared `reasoning` option.
    const reasoningEnabled = this.config.reasoning !== undefined;
    const effort = this.config.reasoning?.effort;
    const harmonyEffort =
      effort === "high" || effort === "medium" ? effort : "low";
    const chatWrapper = resolveChatWrapper(model, {
      customWrapperSettings: {
        qwen: { thoughts: reasoningEnabled ? "auto" : "discourage" },
        gemma4: { reasoning: reasoningEnabled },
        harmony: {
          reasoningEffort: reasoningEnabled ? harmonyEffort : "low",
        },
      },
    });
    return new LlamaChat({
      contextSequence: this.context.getSequence(),
      chatWrapper,
    });
  }

  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    let chat: LlamaChat;
    try {
      chat = await this.getChat();
    } catch (e) {
      // Let a failed init (bad model spec, download failure) be retried.
      this.chatPromise = undefined;
      if (e instanceof ModelError) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new ModelError(`llama.cpp initialization failed: ${msg}`, {
        cause: e,
      });
    }

    if (this.config.promptCache === false) {
      // Drop the sequence's evaluated KV state so this turn prefills the
      // full conversation from scratch instead of reusing the prior
      // turn's prefix.
      await chat.sequence.clearHistory();
    }

    const systemText = extractSystemText(options?.systemPrompt);
    const history = strandsMessagesToHistory(messages, systemText);
    if (history.at(-1)?.type === "user") {
      history.push({ type: "model", response: [] });
    }
    const functions = strandsToolsToFunctions(options?.toolSpecs);
    const originalSchemas = new Map(
      (options?.toolSpecs ?? []).map((spec) => [spec.name, spec.inputSchema]),
    );

    yield new ModelMessageStartEvent({
      type: "modelMessageStartEvent",
      role: "assistant",
    });

    const queue: ModelStreamEvent[] = [];
    let wake: (() => void) | undefined;
    const push = (event: ModelStreamEvent) => {
      queue.push(event);
      wake?.();
    };

    let textBlockOpen = false;
    let reasoningBlockOpen = false;
    const closeOpenBlocks = () => {
      if (reasoningBlockOpen) {
        push(
          new ModelContentBlockStopEvent({
            type: "modelContentBlockStopEvent",
          }),
        );
        reasoningBlockOpen = false;
      }
      if (textBlockOpen) {
        push(
          new ModelContentBlockStopEvent({
            type: "modelContentBlockStopEvent",
          }),
        );
        textBlockOpen = false;
      }
    };

    const meterBefore = {
      input: chat.sequence.tokenMeter.usedInputTokens,
      output: chat.sequence.tokenMeter.usedOutputTokens,
    };

    // Budget 0 closes any thought segment as soon as it opens, covering models
    // whose template ignores the wrapper's discourage setting (e.g. DeepSeek
    // R1 distills that always think).
    const thoughtBudget =
      this.config.reasoning === undefined ? 0 : this.config.thoughtBudgetTokens;

    let done = false;
    let failure: unknown;
    const generation = chat
      .generateResponse(history, {
        ...(functions ? { functions } : {}),
        ...(this.config.maxTokens !== undefined
          ? { maxTokens: this.config.maxTokens }
          : {}),
        ...(this.config.temperature !== undefined
          ? { temperature: this.config.temperature }
          : {}),
        ...(this.config.topP !== undefined ? { topP: this.config.topP } : {}),
        ...(thoughtBudget !== undefined
          ? { budgets: { thoughtTokens: thoughtBudget } }
          : {}),
        onResponseChunk: (chunk) => {
          if (chunk.type === "segment") {
            if (chunk.segmentType !== "thought" || chunk.text.length === 0) {
              return;
            }
            if (textBlockOpen) {
              push(
                new ModelContentBlockStopEvent({
                  type: "modelContentBlockStopEvent",
                }),
              );
              textBlockOpen = false;
            }
            if (!reasoningBlockOpen) {
              push(
                new ModelContentBlockStartEvent({
                  type: "modelContentBlockStartEvent",
                }),
              );
              reasoningBlockOpen = true;
            }
            push(
              new ModelContentBlockDeltaEvent({
                type: "modelContentBlockDeltaEvent",
                delta: { type: "reasoningContentDelta", text: chunk.text },
              }),
            );
            return;
          }
          if (chunk.text.length === 0) {
            return;
          }
          if (reasoningBlockOpen) {
            push(
              new ModelContentBlockStopEvent({
                type: "modelContentBlockStopEvent",
              }),
            );
            reasoningBlockOpen = false;
          }
          if (!textBlockOpen) {
            push(
              new ModelContentBlockStartEvent({
                type: "modelContentBlockStartEvent",
              }),
            );
            textBlockOpen = true;
          }
          push(
            new ModelContentBlockDeltaEvent({
              type: "modelContentBlockDeltaEvent",
              delta: { type: "textDelta", text: chunk.text },
            }),
          );
        },
      })
      .then((res) => {
        closeOpenBlocks();

        const functionCalls = res.functionCalls ?? [];
        let toolIndex = 0;
        for (const call of functionCalls) {
          const name = call.functionName;
          const toolUseId =
            functionCalls.length > 1 ? `${name}_${toolIndex}` : name;
          toolIndex += 1;
          // Drop the `null` markers the GBNF grammar uses for optional keys
          // (see gbnf-schema.ts) so tools receive clean params.
          const params = pruneOptionalNulls(
            call.params ?? {},
            originalSchemas.get(name),
          );
          push(
            new ModelContentBlockStartEvent({
              type: "modelContentBlockStartEvent",
              start: { type: "toolUseStart", name, toolUseId },
            }),
          );
          push(
            new ModelContentBlockDeltaEvent({
              type: "modelContentBlockDeltaEvent",
              delta: {
                type: "toolUseInputDelta",
                input: JSON.stringify(params ?? {}),
              },
            }),
          );
          push(
            new ModelContentBlockStopEvent({
              type: "modelContentBlockStopEvent",
            }),
          );
        }

        const stopReason =
          functionCalls.length > 0
            ? ("toolUse" as const)
            : res.metadata.stopReason === "maxTokens"
              ? ("maxTokens" as const)
              : ("endTurn" as const);
        push(
          new ModelMessageStopEvent({
            type: "modelMessageStopEvent",
            stopReason,
          }),
        );

        const inputTokens =
          chat.sequence.tokenMeter.usedInputTokens - meterBefore.input;
        const outputTokens =
          chat.sequence.tokenMeter.usedOutputTokens - meterBefore.output;
        push(
          new ModelMetadataEvent({
            type: "modelMetadataEvent",
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
            },
          }),
        );
      })
      .catch((e: unknown) => {
        failure = e;
      })
      .finally(() => {
        done = true;
        wake?.();
      });

    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
    await generation;

    if (failure !== undefined) {
      const msg = failure instanceof Error ? failure.message : String(failure);
      if (msg.toLowerCase().includes("context size")) {
        throw new ContextWindowOverflowError(msg);
      }
      throw new ModelError(`llama.cpp generation error: ${msg}`, {
        cause: failure,
      });
    }
  }
}
