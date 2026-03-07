/**
 * Shared event handlers for chat, turn_completed, and scheduled tasks.
 * Used by the event-queue worker (BullMQ) — the only place that runs agents.
 */
import createDebug from "debug";
import type { EventRouter } from "./event-router.js";
import type { ContextStore } from "../chats/context.js";
import type { AuditLog } from "../audit/audit.js";
import type {
  HoomanRunner,
  RunChatOptions,
  RunChatResult,
} from "../agents/hooman-runner.js";
import type { ModelMessage } from "ai";
import type {
  ChannelMeta,
  ResponseDeliveryPayload,
  SlackChannelMeta,
  WhatsAppChannelMeta,
} from "../types.js";
import { HOOMAN_SKIP_MARKER } from "../types.js";
import { getConfig } from "../config.js";
import {
  getPending,
  consumePending,
  clearPending,
  setPending,
  channelKeyFromMeta,
} from "../approval/approval-store.js";
import {
  formatApprovalMessageWithLlm,
  parseApprovalReplyWithLlm,
} from "../approval/approval-llm.js";
import { parseConfirmationReply } from "../approval/confirmation.js";
import type { ConfirmationResult } from "../approval/confirmation.js";
import { mcpResultToToolResultOutput } from "../capabilities/mcp/mcp-service.js";
import type { ToolSettingsStore } from "../capabilities/mcp/tool-settings-store.js";

const debug = createDebug("hooman:event-handlers");

/** Default chat timeout when config CHAT_TIMEOUT_MS is 0 or unset. */
const DEFAULT_CHAT_TIMEOUT_MS = 300_000;

class ChatTimeoutError extends Error {
  constructor() {
    super("Chat timed out");
    this.name = "ChatTimeoutError";
  }
}

export interface EventHandlerDeps {
  eventRouter: EventRouter;
  context: ContextStore;
  auditLog: AuditLog;
  /** Publishes response to Redis; API/Slack/WhatsApp subscribers deliver accordingly. */
  publishResponse: (payload: ResponseDeliveryPayload) => void;
  /** Returns the current agent session (generate). */
  getRunner: () => Promise<HoomanRunner>;
  /** Per-tool settings (disabled, allow-every-time). Used when user replies "always" to approval prompt. */
  toolSettingsStore?: ToolSettingsStore;
  /** Called when allow-every-time is set; invalidates runner cache so next run picks up new settings. */
  invalidateRunnerCache?: () => void;
}

/** Build approval request message with formatting appropriate for the channel (fallback when LLM is not used). */
function formatApprovalMessage(
  channel: "api" | "slack" | "whatsapp" | undefined,
  toolName: string,
  argsPreview: string,
): string {
  const argsDisplay = argsPreview + (argsPreview.length >= 80 ? "…" : "");
  if (channel === "whatsapp") {
    return `I want to run: \`${toolName}\` with \`${argsDisplay}\`. Reply y or yes to allow this time, always (or allow always) to allow this tool every time without asking, or n/no to cancel.`;
  }

  if (channel === "slack") {
    return `I want to run: *${toolName}* with \`${argsDisplay}\`. Reply *y* or *yes* to allow this time, *always* (or *allow always*) to allow this tool every time without asking, or *n*/no to cancel.`;
  }

  return `I want to run: **${toolName}** with \`${argsDisplay}\`. Reply **y** or **yes** to allow this time, **always** (or **allow always**) to allow this tool every time without asking, or **n**/no to cancel.`;
}

function approvalReplyLabelToResult(
  label: "y" | "ya" | "n" | "na",
): ConfirmationResult {
  switch (label) {
    case "y":
      return "confirm";
    case "ya":
      return "allow_every_time";
    case "n":
      return "reject";
    case "na":
    default:
      return "none";
  }
}

export function registerEventHandlers(deps: EventHandlerDeps): void {
  const {
    eventRouter,
    context,
    auditLog,
    publishResponse,
    getRunner,
    toolSettingsStore,
  } = deps;

  /** Runs the agent; optional timeout (e.g. for chat). No timeout = run to completion. */
  async function runAgent(
    history: ModelMessage[],
    text: string,
    runOptions?: RunChatOptions,
    timeoutMs?: number | null,
  ): Promise<RunChatResult> {
    const runner = await getRunner();
    const runPromise = runner.generate(history, text, runOptions);
    if (timeoutMs == null || timeoutMs <= 0) return runPromise;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new ChatTimeoutError()), timeoutMs);
    });
    return Promise.race([runPromise, timeoutPromise]);
  }

  function dispatchResponseToChannel(
    eventId: string,
    source: string,
    channelMeta: ChannelMeta | undefined,
    assistantText: string,
    approvalRequest?: { toolName: string; argsPreview: string },
  ): void | Promise<void> {
    if (assistantText.includes(HOOMAN_SKIP_MARKER)) {
      if (source === "api" && publishResponse) {
        return publishResponse({
          channel: "api",
          eventId,
          skipped: true,
        });
      }
      return;
    }

    if (source === "api" && publishResponse) {
      return publishResponse({
        channel: "api",
        eventId,
        message: {
          role: "assistant",
          text: assistantText,
          ...(approvalRequest ? { approvalRequest } : {}),
        },
      });
    }

    if (source === "slack" && publishResponse) {
      const meta = channelMeta as SlackChannelMeta | undefined;
      if (meta?.channel === "slack") {
        const payload: ResponseDeliveryPayload = {
          channel: "slack",
          channelId: meta.channelId,
          text: assistantText,
          ...(meta.replyInThread && meta.threadTs
            ? { threadTs: meta.threadTs }
            : {}),
        };
        return publishResponse(payload);
      }
    }

    if (source === "whatsapp" && publishResponse) {
      const meta = channelMeta as WhatsAppChannelMeta | undefined;
      if (meta?.channel === "whatsapp") {
        return publishResponse({
          channel: "whatsapp",
          chatId: meta.chatId,
          text: assistantText,
        });
      }
    }
  }

  // Chat handler: message.sent → run agents; dispatch response via publishResponse when set (api → Socket.IO; slack/whatsapp → Redis)
  eventRouter.register(async (event) => {
    if (event.payload.kind !== "message") return;
    const {
      text,
      userId,
      attachmentContents,
      attachments,
      channelMeta,
      sourceMessageType,
    } = event.payload;
    const channelKey = channelKeyFromMeta(
      channelMeta as ChannelMeta | undefined,
    );
    const runOptions: RunChatOptions = {
      channel: channelMeta as ChannelMeta | undefined,
      attachments: attachmentContents,
      sessionId: userId,
    };
    const textPreview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    await auditLog.appendAuditEntry({
      type: "incoming_message",
      payload: {
        source: event.source,
        userId,
        textPreview,
        channel: (channelMeta as { channel?: string } | undefined)?.channel,
        eventId: event.id,
        ...(sourceMessageType ? { sourceMessageType } : {}),
      },
    });
    debug("Processing message eventId=%s userId=%s", event.id, userId);
    const chatTimeoutMs =
      getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;
    let assistantText = "";

    // If there is a pending approval, treat this message as the confirmation reply
    const pending = await getPending(userId, channelKey);
    if (pending) {
      debug(
        "Pending approval found eventId=%s userId=%s toolName=%s",
        event.id,
        userId,
        pending.toolName,
      );
      const toolApprovalMode = getConfig().TOOL_APPROVAL_MODE ?? "llm";
      let reply: ConfirmationResult;
      if (toolApprovalMode === "llm") {
        try {
          const label = await parseApprovalReplyWithLlm(
            text,
            pending.toolName,
            pending.approvalMessage,
          );
          reply = approvalReplyLabelToResult(label);
        } catch {
          reply = "none";
        }
      } else {
        reply = parseConfirmationReply(text);
      }
      if (reply === "reject") {
        await clearPending(userId, channelKey);
        debug(
          "Approval rejected eventId=%s userId=%s toolName=%s",
          event.id,
          userId,
          pending.toolName,
        );
        await auditLog.appendAuditEntry({
          type: "approval_rejected",
          payload: { userId, eventId: event.id, toolName: pending.toolName },
        });
        assistantText = "Cancelled.";
        await dispatchResponseToChannel(
          event.id,
          event.source,
          channelMeta as ChannelMeta | undefined,
          assistantText,
        );
        return;
      }
      if (reply === "none") {
        debug(
          "Pending cleared (reply=none), treating as new message eventId=%s",
          event.id,
        );
        await clearPending(userId, channelKey);
        // Fall through to normal run with text as new user message
      } else if (reply === "confirm" || reply === "allow_every_time") {
        const consumed = await consumePending(userId, channelKey);
        if (!consumed) {
          debug("Approval expired or already consumed eventId=%s", event.id);
          assistantText = "Approval expired. You can try again.";
          await dispatchResponseToChannel(
            event.id,
            event.source,
            channelMeta as ChannelMeta | undefined,
            assistantText,
          );
          return;
        }
        if (
          reply === "allow_every_time" &&
          toolSettingsStore &&
          consumed.toolName
        ) {
          const toolId =
            (consumed as { toolId?: string }).toolId ?? consumed.toolName;
          await toolSettingsStore.setAllowEveryTime(toolId, true);
          deps.invalidateRunnerCache?.();
          await auditLog.appendAuditEntry({
            type: "approval_allow_every_time",
            payload: { userId, toolId, toolName: consumed.toolName },
          });
        } else if (reply === "confirm") {
          await auditLog.appendAuditEntry({
            type: "approval_confirmed",
            payload: { userId, eventId: event.id, toolName: consumed.toolName },
          });
        }
        debug(
          "Approval %s eventId=%s userId=%s toolName=%s",
          reply,
          event.id,
          userId,
          consumed.toolName,
        );
        try {
          const runner = await getRunner();
          debug(
            "Executing approved tool eventId=%s toolName=%s",
            event.id,
            consumed.toolName,
          );
          const toolResult = await runner.executeTool(
            consumed.toolName,
            consumed.toolArgs,
          );
          let thread: ModelMessage[];
          try {
            thread = JSON.parse(consumed.threadSnapshotJson) as ModelMessage[];
          } catch {
            thread = [];
          }
          const toolCallId =
            (consumed as { toolCallId?: string }).toolCallId ??
            `call_${Date.now()}`;
          const toolOutput = mcpResultToToolResultOutput(toolResult);
          const toolResultMessage = {
            role: "tool" as const,
            content: [
              {
                type: "tool-result" as const,
                toolCallId,
                toolName: consumed.toolName,
                output: toolOutput,
              },
            ],
          } as ModelMessage;
          thread.push(toolResultMessage);
          const { output, messages } = await runAgent(
            thread,
            "User approved.",
            runOptions,
            chatTimeoutMs,
          );
          assistantText = output?.trim() || "Done.";
          await context.addTurnToChatHistory(userId, text, assistantText, {
            userAttachments: attachments,
          });
          await dispatchResponseToChannel(
            event.id,
            event.source,
            channelMeta as ChannelMeta | undefined,
            assistantText,
          );
          if (messages?.length) {
            await context.addTurnToAgentThread(userId, messages);
          } else {
            await context.addTurnToAgentThread(userId, [
              { role: "user", content: text },
              { role: "assistant", content: assistantText },
            ] as ModelMessage[]);
          }
        } catch (err) {
          const msg = (err as Error).message;
          debug(
            "Tool execution failed after approval eventId=%s userId=%s toolName=%s: %o",
            event.id,
            userId,
            consumed.toolName,
            err,
          );
          await auditLog.appendAuditEntry({
            type: "approval_tool_execution_failed",
            payload: {
              eventId: event.id,
              userId,
              toolName: consumed.toolName,
              error: msg,
            },
          });
          assistantText = `Tool execution failed: ${msg}. Check API logs.`;
          await dispatchResponseToChannel(
            event.id,
            event.source,
            channelMeta as ChannelMeta | undefined,
            assistantText,
          );
        }
        return;
      }
    }

    try {
      const thread = await context.getThreadForAgent(userId);
      const result = await runAgent(thread, text, runOptions, chatTimeoutMs);

      if (result.needsApproval) {
        debug(
          "Needs approval eventId=%s userId=%s toolName=%s",
          event.id,
          userId,
          result.needsApproval.toolName,
        );
        const argsPreview =
          typeof result.needsApproval.toolArgs === "object"
            ? JSON.stringify(result.needsApproval.toolArgs).slice(0, 80)
            : String(result.needsApproval.toolArgs).slice(0, 80);
        await auditLog.appendAuditEntry({
          type: "approval_requested",
          payload: {
            toolName: result.needsApproval.toolName,
            toolArgsPreview: argsPreview,
            userId,
            channel: (channelMeta as { channel?: string } | undefined)?.channel,
            eventId: event.id,
          },
        });
        const channel =
          (
            channelMeta as
              | { channel?: "api" | "slack" | "whatsapp" }
              | undefined
          )?.channel ?? event.source;
        const channelTyped = channel as "api" | "slack" | "whatsapp";
        const toolApprovalMode = getConfig().TOOL_APPROVAL_MODE ?? "llm";
        const approvalMessage =
          toolApprovalMode === "llm"
            ? await formatApprovalMessageWithLlm(
                channelTyped,
                result.needsApproval.toolName,
                argsPreview,
              )
            : formatApprovalMessage(
                channelTyped,
                result.needsApproval.toolName,
                argsPreview,
              );
        await setPending(
          userId,
          {
            userId,
            channelMeta: runOptions.channel,
            eventId: event.id,
            toolName: result.needsApproval.toolName,
            toolArgs: result.needsApproval.toolArgs,
            threadSnapshotJson: JSON.stringify(
              result.needsApproval.threadSnapshot,
            ),
            approvalMessage,
            ...(result.needsApproval.toolCallId
              ? { toolCallId: result.needsApproval.toolCallId }
              : {}),
            ...(result.needsApproval.toolId
              ? { toolId: result.needsApproval.toolId }
              : {}),
          },
          channelKey,
        );
        const approvalRequest = {
          toolName: result.needsApproval.toolName,
          argsPreview,
        };
        await dispatchResponseToChannel(
          event.id,
          event.source,
          channelMeta as ChannelMeta | undefined,
          approvalMessage,
          event.source === "api" ? approvalRequest : undefined,
        );
        await context.addTurnToChatHistory(userId, text, approvalMessage, {
          userAttachments: attachments,
          approvalRequest: event.source === "api" ? approvalRequest : undefined,
        });
        return;
      }

      const { output, messages } = result;
      assistantText =
        output?.trim() ||
        "I didn't get a clear response. Try rephrasing or check your API key and model settings.";
      auditLog.emitResponse({
        type: "response",
        text: assistantText,
        eventId: event.id,
        userInput: text,
      });
      await context.addTurnToChatHistory(userId, text, assistantText, {
        userAttachments: attachments,
      });
      debug(
        "Dispatching response eventId=%s len=%d",
        event.id,
        assistantText.length,
      );
      await dispatchResponseToChannel(
        event.id,
        event.source,
        channelMeta as ChannelMeta | undefined,
        assistantText,
      );
      if (messages?.length) {
        await context.addTurnToAgentThread(userId, messages);
      } else {
        await context.addTurnToAgentThread(userId, [
          { role: "user", content: text },
          { role: "assistant", content: assistantText },
        ] as ModelMessage[]);
      }
    } catch (err) {
      if (err instanceof ChatTimeoutError) {
        const chatTimeoutMs =
          getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;
        debug("Chat timed out after %s ms", chatTimeoutMs);
        assistantText =
          "This is taking longer than expected. The agent may be using a tool. You can try again or rephrase.";
      } else {
        const msg = (err as Error).message;
        assistantText = `Something went wrong: ${msg}. Check API logs.`;
        debug("Chat handler error eventId=%s: %o", event.id, err);
      }

      await context.addTurnToChatHistory(userId, text, assistantText, {
        userAttachments: attachments,
      });
      debug("Dispatching error response eventId=%s", event.id);
      await dispatchResponseToChannel(
        event.id,
        event.source,
        channelMeta as ChannelMeta | undefined,
        assistantText,
      );
      await context.addTurnToAgentThread(userId, [
        { role: "user", content: text },
        { role: "assistant", content: assistantText },
      ] as ModelMessage[]);
    }
  });

  // Scheduled task handler
  eventRouter.register(async (event) => {
    if (event.payload.kind !== "scheduled_task") return;
    const payload = event.payload;
    const contextStr =
      Object.keys(payload.context).length === 0
        ? "(none)"
        : Object.entries(payload.context)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(", ");
    const text = `Scheduled task: ${payload.intent}. Context: ${contextStr}.`;
    const runOptions: RunChatOptions = {
      sessionId: payload.context.userId
        ? String(payload.context.userId)
        : undefined,
    };
    try {
      const chatTimeoutMs =
        getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;
      const { output } = await runAgent([], text, runOptions, chatTimeoutMs);
      const assistantText =
        output?.trim() ||
        "Scheduled task completed (no clear response from agent).";
      await auditLog.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          intent: payload.intent,
          context: payload.context,
          ...(payload.execute_at ? { execute_at: payload.execute_at } : {}),
          ...(payload.cron ? { cron: payload.cron } : {}),
        },
      });
      auditLog.emitResponse({
        type: "response",
        text: assistantText,
        eventId: event.id,
        userInput: text,
      });
    } catch (err) {
      debug("scheduled task handler error: %o", err);
      const msg = (err as Error).message;
      await auditLog.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          intent: payload.intent,
          context: payload.context,
          ...(payload.execute_at ? { execute_at: payload.execute_at } : {}),
          ...(payload.cron ? { cron: payload.cron } : {}),
          error: msg,
        },
      });
      auditLog.emitResponse({
        type: "response",
        text: `Scheduled task failed: ${msg}. Check API logs.`,
        eventId: event.id,
        userInput: text,
      });
    }
  });
}
