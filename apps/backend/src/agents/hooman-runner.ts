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

export interface RunChatResult {
  output: string;
  /** Full AI SDK messages for this turn (user + assistant with tool calls/results). Store via context.addTurnToAgentThread for recollect. */
  messages?: ModelMessage[];
}

export interface HoomanRunner {
  generate(
    history: ModelMessage[],
    message: string,
    options?: RunChatOptions,
  ): Promise<RunChatResult>;
}

export type AuditLogAppender = {
  appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void>;
};

export async function createHoomanRunner(options: {
  agentTools: Record<string, unknown>;
  auditLog?: AuditLogAppender;
  sessionId?: string;
  skillService?: SkillService;
}): Promise<HoomanRunner> {
  const config = getConfig();
  const model = getHoomanModel(config);

  const {
    agentTools,
    auditLog,
    sessionId,
    skillService: injectedSkillService,
  } = options;

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
        tools: agentTools as ToolSet,
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
      const messages: ModelMessage[] = [prompt, ...response.response.messages];

      return {
        output: response.text ?? "",
        messages,
      };
    },
  };
}
