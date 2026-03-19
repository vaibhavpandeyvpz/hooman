/**
 * Shared utilities for the chat handler: runAgent, dispatch, approval helpers.
 */
import type { AgentInputItem } from "@openai/agents";
import type {
  HoomanRunner,
  RunChatOptions,
  RunChatResult,
  RunStreamCallbacks,
} from "../agents/hooman-runner.js";
import type {
  ChannelMeta,
  ResponseDeliveryPayload,
  SlackChannelMeta,
  WhatsAppChannelMeta,
} from "../types.js";
import { HOOMAN_SKIP_MARKER } from "../types.js";
import type { ConfirmationResult } from "../approval/confirmation.js";
import { slackReplyThreadTs } from "../channels/slack-adapter.js";

/** Default chat timeout when config CHAT_TIMEOUT_MS is 0 or unset. */
export const DEFAULT_CHAT_TIMEOUT_MS = 300_000;

export class ChatTimeoutError extends Error {
  constructor() {
    super("Chat timed out");
    this.name = "ChatTimeoutError";
  }
}

export interface RunAgentFn {
  (
    history: AgentInputItem[],
    text: string | string[],
    runOptions?: RunChatOptions,
    timeoutMs?: number | null,
    callbacks?: RunStreamCallbacks,
  ): Promise<RunChatResult>;
}

export function createRunAgent(
  getRunner: () => Promise<HoomanRunner>,
): RunAgentFn {
  return async (
    history,
    text,
    runOptions,
    timeoutMs,
    callbacks,
  ): Promise<RunChatResult> => {
    const runner = await getRunner();
    const runPromise = runner.generate(history, text, runOptions, callbacks);
    if (timeoutMs == null || timeoutMs <= 0) return runPromise;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new ChatTimeoutError()), timeoutMs);
    });
    return Promise.race([runPromise, timeoutPromise]);
  };
}

export function dispatchResponseToChannel(
  publishResponse: (payload: ResponseDeliveryPayload) => void,
  eventId: string,
  source: string,
  channelMeta: ChannelMeta | undefined,
  assistantText: string,
  approvalRequest?: { toolName: string; argsPreview: string },
): void | Promise<void> {
  if (assistantText.includes(HOOMAN_SKIP_MARKER)) {
    if (source === "api") {
      return publishResponse({
        channel: "api",
        eventId,
        skipped: true,
      });
    }
    if (source === "web") {
      return publishResponse({
        channel: "web",
        eventId,
        skipped: true,
      });
    }
    return;
  }

  if (source === "api") {
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
  if (source === "web") {
    return publishResponse({
      channel: "web",
      eventId,
      message: {
        role: "assistant",
        text: assistantText,
        ...(approvalRequest ? { approvalRequest } : {}),
      },
    });
  }

  if (source === "slack") {
    const meta = channelMeta as SlackChannelMeta | undefined;
    if (meta?.channel === "slack") {
      const replyThreadTs = slackReplyThreadTs(meta);
      const payload: ResponseDeliveryPayload = {
        channel: "slack",
        channelId: meta.message.channel.id,
        text: assistantText,
        ...(replyThreadTs ? { threadTs: replyThreadTs } : {}),
      };
      return publishResponse(payload);
    }
  }

  if (source === "whatsapp") {
    const meta = channelMeta as WhatsAppChannelMeta | undefined;
    if (meta?.channel === "whatsapp") {
      return publishResponse({
        channel: "whatsapp",
        chatId: meta.message.chat.id,
        text: assistantText,
      });
    }
  }
}

export function formatApprovalMessage(
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

export function approvalReplyLabelToResult(
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
