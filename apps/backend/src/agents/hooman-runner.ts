/**
 * Hooman agent run via OpenAI Agents SDK. No personas; MCP and skills attached to main flow.
 */
import { getHoomanModel } from "./model-provider.js";
import createDebug from "debug";
import { Agent, run, tool, type AgentInputItem } from "@openai/agents";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import {
  createSkillService,
  type SkillService,
} from "../capabilities/skills/skills-service.js";
import type {
  AuditLogEntry,
  ChannelMeta,
  ChatProgressStage,
} from "../types.js";
import {
  getConfig,
  getFullStaticAgentInstructionsAppend,
  getSystemMcpServers,
} from "../config.js";
import { buildChannelContext } from "../channels/shared.js";
import { buildAgentSystemPrompt } from "../utils/prompts.js";
import { runWithTimeout, truncateForMax } from "../utils/helpers.js";
import { readFile } from "fs/promises";

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

type UserInputContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image: string; detail?: string }
  | { type: "input_file"; file: string; filename?: string };

async function buildUserContentParts(
  text: string,
  attachments?: Array<{ name: string; path: string; mime: string }>,
  enableFileInput = true,
): Promise<UserInputContentPart[]> {
  const parts: UserInputContentPart[] = [
    { type: "input_text", text: text ?? "" },
  ];
  const skippedPaths: string[] = [];
  if (attachments?.length) {
    for (const a of attachments) {
      const contentType = a.mime.toLowerCase().split(";")[0].trim();
      const isImage = IMAGE_MIME_TYPES.includes(
        contentType as (typeof IMAGE_MIME_TYPES)[number],
      );
      if (isImage) {
        try {
          const buf = await readFile(a.path);
          const data = buf.toString("base64").replace(/\s/g, "").trim();
          if (!data) continue;
          const dataUrl = `data:${contentType};base64,${data}`;
          parts.push({ type: "input_image", image: dataUrl, detail: "auto" });
        } catch (e) {
          debug("Attachment read failed path=%s: %o", a.path, e);
        }
      } else if (enableFileInput) {
        try {
          const buf = await readFile(a.path);
          const data = buf.toString("base64").replace(/\s/g, "").trim();
          if (!data) continue;
          const dataUrl = `data:${contentType};base64,${data}`;
          parts.push({
            type: "input_file",
            file: dataUrl,
            filename: a.name,
          });
        } catch (e) {
          debug("Attachment read failed path=%s: %o", a.path, e);
        }
      } else {
        debug(
          "Skipping non-image attachment (file input disabled): %s",
          a.name,
        );
        skippedPaths.push(a.path);
      }
    }
  }
  if (skippedPaths.length > 0) {
    parts.push({
      type: "input_text",
      text: `Files uploaded:\n${skippedPaths.join("\n")}`,
    });
  }
  return parts;
}

const debug = createDebug("hooman:hooman-runner");
const DEBUG_TOOL_LOG_MAX = 200; // max chars for args/result in logs
const AUDIT_TOOL_PAYLOAD_MAX = 100; // max chars for tool args/result in audit log

export type RunProgressStage = ChatProgressStage;

export interface RunStreamCallbacks {
  onStage?: (stage: RunProgressStage) => void | Promise<void>;
  onTextDelta?: (delta: string) => void | Promise<void>;
}

export interface RunChatOptions {
  source?: string;
  channel?: ChannelMeta;
  sessionId?: string;
  attachments?: Array<{ name: string; path: string; mime: string }>;
}

export interface NeedsApprovalPayload {
  toolName: string;
  toolArgs: unknown;
  /** SDK tool call id for building tool result message on resume. */
  toolCallId: string;
  /** Tool id (e.g. connectionId/name) for allow-every-time store; may be same as toolName if not provided. */
  toolId?: string;
  /** Full thread at pause (history + user message + assistant tool call). Used to resume after approval. */
  threadSnapshot: AgentInputItem[];
  /** Length of history already in memory when we paused. threadSnapshot.slice(historyLength) is the turn not yet persisted. */
  historyLength: number;
}

export interface RunChatResult {
  output: string;
  /** Full OpenAI Agents items for this turn. */
  messages?: AgentInputItem[];
  /** Set when the model requested a tool that requires approval; runner paused. Handler should save pending and send approval prompt. */
  needsApproval?: NeedsApprovalPayload;
}

export interface HoomanRunner {
  generate(
    history: AgentInputItem[],
    message: string | string[],
    options?: RunChatOptions,
    callbacks?: RunStreamCallbacks,
  ): Promise<RunChatResult>;
  /** Execute a single tool by name (used on approval confirm to run the tool before resume). */
  executeTool(toolName: string, toolArgs: unknown): Promise<unknown>;
}

export type AuditLogAppender = {
  appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void>;
};

type OpenAIAgentTool = {
  description?: string;
  inputSchema?: unknown;
  parameters?: unknown;
  execute?: (args: unknown) => Promise<unknown>;
};

function toJsonSchema(parameters: unknown): Record<string, unknown> {
  if (
    parameters &&
    typeof parameters === "object" &&
    !Array.isArray(parameters)
  )
    return parameters as Record<string, unknown>;
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: true,
  };
}

function buildOpenAITools(options: {
  agentTools: Record<string, unknown>;
  toolsThatNeedApproval: Set<string>;
  toolTimeoutMs: number | undefined;
  auditLog?: AuditLogAppender;
}): Array<ReturnType<typeof tool>> {
  const { agentTools, toolsThatNeedApproval, toolTimeoutMs, auditLog } =
    options;
  const out: Array<ReturnType<typeof tool>> = [];
  for (const [name, raw] of Object.entries(agentTools)) {
    const t = raw as OpenAIAgentTool;
    if (typeof t.execute !== "function") continue;
    out.push(
      tool({
        name,
        description: t.description ?? "",
        parameters: toJsonSchema(t.inputSchema ?? t.parameters) as any,
        strict: false,
        ...(toolTimeoutMs && toolTimeoutMs > 0
          ? {
              timeoutMs: toolTimeoutMs,
              timeoutBehavior: "raise_exception" as const,
            }
          : {}),
        needsApproval: async (runContext: unknown) => {
          const source = (runContext as { context?: { source?: string } })
            ?.context?.source;
          if (source === "api" || source === "scheduler") return false;
          return toolsThatNeedApproval.has(name);
        },
        async execute(input) {
          debug(
            "Tool call: %s args=%s",
            name,
            truncateForMax(input, DEBUG_TOOL_LOG_MAX),
          );
          if (auditLog) {
            void auditLog.appendAuditEntry({
              type: "tool_call_start",
              payload: {
                toolName: name,
                input: truncateForMax(input, AUDIT_TOOL_PAYLOAD_MAX),
              },
            });
          }
          const result = await t.execute!(input);
          if (auditLog) {
            void auditLog.appendAuditEntry({
              type: "tool_call_end",
              payload: {
                toolName: name,
                result: truncateForMax(result, AUDIT_TOOL_PAYLOAD_MAX),
              },
            });
          }
          return result;
        },
      }),
    );
  }
  return out;
}

function parseToolArgs(rawArgs: string | undefined): unknown {
  if (!rawArgs || rawArgs.trim() === "") return {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function mapRunItemEventNameToStage(
  name: string,
): Exclude<RunProgressStage, "done"> {
  switch (name) {
    case "tool_search_called":
    case "tool_called":
      return "searching";
    case "tool_search_output_created":
    case "tool_output":
    case "reasoning_item_created":
      return "organizing";
    case "message_output_created":
      return "writing";
    case "tool_approval_requested":
      return "awaiting_approval";
    default:
      return "thinking";
  }
}

export async function createHoomanRunner(options: {
  agentTools: Record<string, unknown>;
  /** Prefixed tool names that require HITL approval before execution. */
  toolsThatNeedApproval?: Set<string>;
  /** Optional map from prefixed tool name to tool id (for allow-every-time store). */
  prefixedNameToToolId?: Map<string, string>;
  auditLog?: AuditLogAppender;
  sessionId?: string;
  skillService?: SkillService;
}): Promise<HoomanRunner> {
  const config = getConfig();

  const {
    agentTools,
    toolsThatNeedApproval = new Set<string>(),
    prefixedNameToToolId,
    auditLog,
    sessionId,
    skillService: injectedSkillService,
  } = options;

  const skillService = injectedSkillService ?? createSkillService();
  const systemMcpList = getSystemMcpServers();
  const skillsMcpEnabled = systemMcpList
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes("skills");
  const skillsSection = skillsMcpEnabled
    ? await skillService.getSkillsMetadataSection()
    : "";

  const fullSystem = buildAgentSystemPrompt({
    userInstructions: (config.AGENT_INSTRUCTIONS ?? "").trim(),
    staticAppend: getFullStaticAgentInstructionsAppend(),
    skillsSection,
    sessionId,
  });
  const toolTimeoutMs = getConfig().TOOL_TIMEOUT_MS ?? 300_000;
  const openAiTools = buildOpenAITools({
    agentTools,
    toolsThatNeedApproval,
    toolTimeoutMs: toolTimeoutMs > 0 ? toolTimeoutMs : undefined,
    auditLog,
  });
  const openAiModel = aisdk(getHoomanModel(config) as any);
  const maxTurns = getConfig().MAX_TURNS || 999;
  const agent = new Agent({
    name: "Hooman",
    instructions: fullSystem,
    model: openAiModel,
    tools: openAiTools,
  });

  return {
    async generate(history, message, options, callbacks) {
      const input: AgentInputItem[] = [...history];
      const messageParts = Array.isArray(message)
        ? message.map((m) => m.trim()).filter((m) => m.length > 0)
        : typeof message === "string" && message.trim().length > 0
          ? [message.trim()]
          : [];
      const hasUserContent =
        messageParts.length > 0 || (options?.attachments?.length ?? 0) > 0;
      if (hasUserContent) {
        const channelContext = buildChannelContext(options?.channel);
        const turns = messageParts.length > 0 ? messageParts : [""];
        const enableFileInput = getConfig().ENABLE_FILE_INPUT === true;
        for (let i = 0; i < turns.length; i += 1) {
          const turnText = turns[i] ?? "";
          const isLastTurn = i === turns.length - 1;
          const userContent = await buildUserContentParts(
            turnText,
            isLastTurn ? options?.attachments : undefined,
            enableFileInput,
          );
          const prompt: AgentInputItem = {
            type: "message",
            role: "user",
            content:
              i === 0 && channelContext?.trim()
                ? [
                    {
                      type: "input_text",
                      text: `### Channel Context\nThe following message originated from an external channel. Details are as below:\n\n${channelContext.trim()}\n\n---\n\n`,
                    },
                    ...userContent,
                  ]
                : userContent,
          };
          input.push(prompt);
        }
      }

      const latest = input.length > 0 ? input[input.length - 1] : null;
      debug("Model input (latest item): %s", JSON.stringify(latest, null, 2));

      const result = await run(agent, input, {
        maxTurns,
        stream: true,
        context: { source: options?.source ?? null },
      });
      let lastStage: RunProgressStage | null = null;
      const emitStage = async (stage: RunProgressStage) => {
        if (!callbacks?.onStage || lastStage === stage) return;
        lastStage = stage;
        await callbacks.onStage(stage);
      };
      await emitStage("thinking");
      for await (const event of result) {
        if (event.type === "raw_model_stream_event") {
          const data = event.data as { type?: string; delta?: string };
          if (
            data.type === "output_text_delta" &&
            typeof data.delta === "string" &&
            data.delta.length > 0
          ) {
            await emitStage("writing");
            if (callbacks?.onTextDelta) await callbacks.onTextDelta(data.delta);
          }
          continue;
        }
        if (event.type === "run_item_stream_event") {
          const stage = mapRunItemEventNameToStage(event.name);
          await emitStage(stage);
        }
      }
      await result.completed;
      const interruption = result.interruptions?.[0];
      if (interruption) {
        const name =
          interruption.toolName ??
          interruption.name ??
          (interruption.rawItem as { name?: string }).name;
        if (!name) {
          throw new Error("Tool approval interruption missing tool name");
        }
        const toolCallId = String(
          (interruption.rawItem as { callId?: string }).callId ??
            `call_${Date.now()}`,
        );
        const toolArgs = parseToolArgs(interruption.arguments);
        debug(
          "Tool requires approval, pausing toolName=%s args=%s",
          name,
          truncateForMax(toolArgs, DEBUG_TOOL_LOG_MAX),
        );
        const threadSnapshot: AgentInputItem[] = result.history;
        const toolId = prefixedNameToToolId?.get(name);
        const historyLength = history.length;
        return {
          output: "",
          needsApproval: {
            toolName: name,
            toolArgs,
            toolCallId,
            toolId: toolId ?? name,
            threadSnapshot,
            historyLength,
          },
        };
      }
      await emitStage("done");

      const stepCount = result.newItems?.length ?? 0;
      const finishReason = result.interruptions?.length
        ? "interrupted"
        : "done";
      if (auditLog) {
        void auditLog.appendAuditEntry({
          type: "run_summary",
          payload: {
            stepCount,
            totalToolCalls: stepCount,
            finishReason,
          },
        });
      }
      const threadSnapshot = result.history as AgentInputItem[];
      const messages: AgentInputItem[] = threadSnapshot.slice(history.length);

      return {
        output:
          typeof result.finalOutput === "string"
            ? result.finalOutput
            : String(result.finalOutput ?? ""),
        messages,
      };
    },

    async executeTool(toolName: string, toolArgs: unknown): Promise<unknown> {
      debug(
        "Executing tool toolName=%s args=%s",
        toolName,
        truncateForMax(toolArgs, DEBUG_TOOL_LOG_MAX),
      );
      const rawTool = agentTools[toolName] as
        | { execute?: (args: unknown) => Promise<unknown> }
        | undefined;
      if (!rawTool?.execute) {
        debug("Tool not found or has no execute: %s", toolName);
        throw new Error(`Tool not found or has no execute: ${toolName}`);
      }
      const toolTimeoutMs = getConfig().TOOL_TIMEOUT_MS ?? 300_000;
      const timeoutError = new Error(
        `Tool "${toolName}" timed out after ${toolTimeoutMs}ms`,
      );
      timeoutError.name = "ToolTimeoutError";
      try {
        const result = await runWithTimeout(
          () => rawTool.execute!(toolArgs),
          toolTimeoutMs > 0 ? toolTimeoutMs : null,
          timeoutError,
        );
        debug("Tool completed toolName=%s", toolName);
        return result;
      } catch (err) {
        debug("Tool execution error toolName=%s: %o", toolName, err);
        throw err;
      }
    },
  };
}
