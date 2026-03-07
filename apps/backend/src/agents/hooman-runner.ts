/**
 * Hooman agent run via Vercel AI SDK (ToolLoopAgent + tools). No personas; MCP and skills attached to main flow.
 */
import { getHoomanModel } from "./model-provider.js";
import { ToolLoopAgent, ToolSet, stepCountIs } from "ai";
import type { FilePart, ImagePart, ModelMessage, TextPart } from "ai";
import createDebug from "debug";
import {
  createSkillService,
  type SkillService,
} from "../capabilities/skills/skills-service.js";
import type { AuditLogEntry, ChannelMeta } from "../types.js";
import { getConfig, getFullStaticAgentInstructionsAppend } from "../config.js";
import { buildChannelContext } from "../channels/shared.js";
import { buildAgentSystemPrompt } from "../utils/prompts.js";
import { truncateForMax } from "../utils/helpers.js";

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

type UserContentPart = TextPart | ImagePart | FilePart;

function buildUserContentParts(
  text: string,
  attachments?: Array<{ name: string; contentType: string; data: string }>,
): UserContentPart[] {
  const parts: UserContentPart[] = [{ type: "text", text }];
  if (attachments?.length) {
    for (const a of attachments) {
      const data = typeof a.data === "string" ? a.data.trim() : "";
      if (!data) continue;
      const contentType = a.contentType.toLowerCase().split(";")[0].trim();
      const dataUrl = `data:${contentType};base64,${data}`;
      if (
        IMAGE_MIME_TYPES.includes(
          contentType as (typeof IMAGE_MIME_TYPES)[number],
        )
      ) {
        parts.push({ type: "image", image: dataUrl, mediaType: contentType });
      } else {
        parts.push({ type: "file", data: dataUrl, mediaType: contentType });
      }
    }
  }
  return parts;
}

const debug = createDebug("hooman:hooman-runner");
const DEBUG_TOOL_LOG_MAX = 200; // max chars for args/result in logs
const AUDIT_TOOL_PAYLOAD_MAX = 100; // max chars for tool args/result in audit log

export interface RunChatOptions {
  channel?: ChannelMeta;
  sessionId?: string;
  attachments?: Array<{
    name: string;
    contentType: string;
    data: string;
  }>;
}

export interface NeedsApprovalPayload {
  toolName: string;
  toolArgs: unknown;
  /** SDK tool call id for building tool result message on resume. */
  toolCallId: string;
  /** Tool id (e.g. connectionId/name) for allow-every-time store; may be same as toolName if not provided. */
  toolId?: string;
  threadSnapshot: ModelMessage[];
}

export interface RunChatResult {
  output: string;
  /** Full AI SDK messages for this turn (user + assistant with tool calls/results). Store via context.addTurnToAgentThread for recollect. */
  messages?: ModelMessage[];
  /** Set when the model requested a tool that requires approval; runner paused. Handler should save pending and send approval prompt. */
  needsApproval?: NeedsApprovalPayload;
}

export interface HoomanRunner {
  generate(
    history: ModelMessage[],
    message: string,
    options?: RunChatOptions,
  ): Promise<RunChatResult>;
  /** Execute a single tool by name (used on approval confirm to run the tool before resume). */
  executeTool(toolName: string, toolArgs: unknown): Promise<unknown>;
}

export type AuditLogAppender = {
  appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void>;
};

/** Wraps tools so that those in toolsThatNeedApproval have needsApproval: true (SDK will pause and return tool-approval-request). */
function wrapToolsForApproval(
  agentTools: Record<string, unknown>,
  toolsThatNeedApproval: Set<string>,
): Record<string, unknown> {
  if (toolsThatNeedApproval.size === 0) return agentTools;
  const wrapped: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(agentTools)) {
    const t = tool as Record<string, unknown>;
    if (toolsThatNeedApproval.has(name)) {
      wrapped[name] = { ...t, needsApproval: true };
    } else {
      wrapped[name] = tool;
    }
  }
  return wrapped;
}

/** Detect tool-approval-request in SDK result (content or last step content). */
function getApprovalRequestFromResponse(response: {
  content?: Array<{
    type: string;
    toolCall?: { toolCallId?: string; toolName?: string; input?: unknown };
    approvalId?: string;
  }>;
  steps?: Array<{
    content?: Array<{
      type: string;
      toolCall?: { toolCallId?: string; toolName?: string; input?: unknown };
      approvalId?: string;
    }>;
  }>;
}): { toolName: string; toolArgs: unknown; toolCallId: string } | null {
  const check = (
    content:
      | Array<{
          type: string;
          toolCall?: {
            toolCallId?: string;
            toolName?: string;
            input?: unknown;
          };
          approvalId?: string;
        }>
      | undefined,
  ) => {
    if (!content) return null;
    const part = content.find((p) => p.type === "tool-approval-request");
    if (!part?.toolCall) return null;
    const tc = part.toolCall;
    const name = tc.toolName ?? (tc as { name?: string }).name;
    if (!name) return null;
    const toolCallId =
      tc.toolCallId ?? (tc as { id?: string }).id ?? `call_${Date.now()}`;
    return {
      toolName: name,
      toolArgs:
        (tc as { input?: unknown }).input ?? (tc as { args?: unknown }).args,
      toolCallId,
    };
  };
  if (response.content) {
    const found = check(response.content);
    if (found) return found;
  }
  const steps = response.steps ?? [];
  if (steps.length > 0) {
    const last = steps[steps.length - 1];
    const found = check(last?.content);
    if (found) return found;
  }
  return null;
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
  const model = getHoomanModel(config);

  const {
    agentTools,
    toolsThatNeedApproval = new Set<string>(),
    prefixedNameToToolId,
    auditLog,
    sessionId,
    skillService: injectedSkillService,
  } = options;

  const wrappedTools = wrapToolsForApproval(
    agentTools,
    toolsThatNeedApproval,
  ) as ToolSet;

  const skillService = injectedSkillService ?? createSkillService();
  const skillsSection = await skillService.getSkillsMetadataSection();

  const fullSystem = buildAgentSystemPrompt({
    userInstructions: (config.AGENT_INSTRUCTIONS ?? "").trim(),
    staticAppend: getFullStaticAgentInstructionsAppend(),
    skillsSection,
    sessionId,
  });

  return {
    async generate(history, message, options) {
      const input: ModelMessage[] = [...history];
      const channelContext = buildChannelContext(options?.channel);
      const userContent = buildUserContentParts(message, options?.attachments);
      const prompt: ModelMessage = channelContext?.trim()
        ? {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: `### Channel Context\nThe following message originated from an external channel. Details are as below:\n\n${channelContext.trim()}\n\n---\n\n`,
              },
              ...userContent,
            ],
          }
        : { role: "user", content: userContent };
      input.push(prompt);

      const maxSteps = getConfig().MAX_TURNS || 999;
      const agent = new ToolLoopAgent({
        model,
        instructions: fullSystem,
        tools: wrappedTools,
        stopWhen: stepCountIs(maxSteps),
        experimental_onToolCallStart({ toolCall }) {
          const name =
            toolCall.toolName ?? (toolCall as { name?: string }).name;
          const input =
            (toolCall as { input?: unknown }).input ??
            (toolCall as { args?: unknown }).args;
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
        },
        experimental_onToolCallFinish({ toolCall, success, output, error }) {
          const name =
            toolCall.toolName ?? (toolCall as { name?: string }).name;
          const result = success ? output : error;
          debug(
            "Tool result: %s result=%s",
            name,
            truncateForMax(result, DEBUG_TOOL_LOG_MAX),
          );
          if (auditLog) {
            void auditLog.appendAuditEntry({
              type: "tool_call_end",
              payload: {
                toolName: name,
                result:
                  result !== undefined
                    ? truncateForMax(result, AUDIT_TOOL_PAYLOAD_MAX)
                    : "(no result)",
              },
            });
          }
        },
        onFinish(finishResult) {
          const steps = finishResult.steps ?? [];
          const stepCount = steps.length;
          const totalToolCalls = steps.reduce(
            (n, s) => n + (Array.isArray(s.toolCalls) ? s.toolCalls.length : 0),
            0,
          );
          const finishReason =
            typeof finishResult.finishReason === "string"
              ? finishResult.finishReason
              : String(finishResult.finishReason ?? "unknown");
          debug(
            "Run finished: steps=%d toolCalls=%d finishReason=%s",
            stepCount,
            totalToolCalls,
            finishReason,
          );
          if (auditLog) {
            void auditLog.appendAuditEntry({
              type: "run_summary",
              payload: {
                stepCount,
                totalToolCalls,
                finishReason,
              },
            });
          }
        },
      });

      const response = await agent.generate({ messages: input });
      const approvalReq = getApprovalRequestFromResponse(response);
      if (approvalReq) {
        debug(
          "Tool requires approval, pausing toolName=%s args=%s",
          approvalReq.toolName,
          truncateForMax(approvalReq.toolArgs, DEBUG_TOOL_LOG_MAX),
        );
        const threadSnapshot: ModelMessage[] = [
          ...input,
          ...(response.response?.messages ?? []),
        ];
        const toolId = prefixedNameToToolId?.get(approvalReq.toolName);
        return {
          output: "",
          needsApproval: {
            toolName: approvalReq.toolName,
            toolArgs: approvalReq.toolArgs,
            toolCallId: approvalReq.toolCallId,
            toolId: toolId ?? approvalReq.toolName,
            threadSnapshot,
          },
        };
      }

      const messages: ModelMessage[] = [prompt, ...response.response.messages];

      return {
        output: response.text ?? "",
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
      try {
        const result = await rawTool.execute(toolArgs);
        debug("Tool completed toolName=%s", toolName);
        return result;
      } catch (err) {
        debug("Tool execution error toolName=%s: %o", toolName, err);
        throw err;
      }
    },
  };
}
