/**
 * Chat event handler: message.sent → run agents, dispatch response.
 * Extracted from event-handlers.ts for clarity.
 */
import createDebug from "debug";
import type { NormalizedEvent } from "../types.js";
import type { ContextStore } from "../chats/context.js";
import type { AuditLog } from "../audit/audit.js";
import type {
  HoomanRunner,
  RunChatOptions,
  RunChatResult,
  RunStreamCallbacks,
} from "../agents/hooman-runner.js";
import type { AgentInputItem } from "@openai/agents";
import type {
  ChannelMeta,
  NormalizedMessagePayload,
  ChatProgressStage,
  ResponseDeliveryPayload,
  SavedAttachment,
} from "../types.js";
import { slackConversationThreadTs } from "../channels/slack-adapter.js";
import type { PendingApproval } from "../approval/approval-store.js";
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
import type { ToolSettingsStore } from "../capabilities/mcp/tool-settings-store.js";
import { getConfig } from "../config.js";
import {
  ChatTimeoutError,
  DEFAULT_CHAT_TIMEOUT_MS,
  type RunAgentFn,
  dispatchResponseToChannel as dispatch,
  formatApprovalMessage,
  approvalReplyLabelToResult,
} from "./chat-handler-shared.js";
import type { AttachmentService } from "../attachments/attachment-service.js";

const debug = createDebug("hooman:chat-handler");

/** Resolve SavedAttachment[] to path-based list for the runner (read from path when building model input). */
async function resolveSavedAttachmentsToPaths(
  service: AttachmentService,
  userId: string,
  saved: SavedAttachment[],
): Promise<Array<{ name: string; path: string; mime: string }>> {
  const out: Array<{ name: string; path: string; mime: string }> = [];
  for (const a of saved) {
    const path = await service.getPath(a.id, userId);
    if (path) out.push({ name: a.originalName, path, mime: a.mimeType });
  }
  return out;
}

interface ToolCallFullInfo {
  toolCallId: string;
  toolName: string;
  toolArgs: unknown;
}

function toTextParts(text: string | string[]): string[] {
  if (Array.isArray(text)) {
    return text
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t) => t.length > 0);
  }
  const t = (text ?? "").trim();
  return t ? [t] : [];
}

function toLatestText(text: string | string[]): string {
  const parts = toTextParts(text);
  return parts[parts.length - 1] ?? "";
}

function toCombinedText(text: string | string[]): string {
  return toTextParts(text).join("\n");
}

/** Collect all tool calls from OpenAI agent history items (function_call). */
function collectToolCalls(thread: AgentInputItem[]): ToolCallFullInfo[] {
  const out: ToolCallFullInfo[] = [];
  for (const item of thread as Array<Record<string, unknown>>) {
    if (item.type !== "function_call") continue;
    let toolArgs: unknown = {};
    if (typeof item.arguments === "string" && item.arguments.length > 0) {
      try {
        toolArgs = JSON.parse(String(item.arguments));
      } catch {
        toolArgs = {};
      }
    }
    out.push({
      toolCallId: String(item.callId ?? `call_${Date.now()}`),
      toolName: String(item.name ?? "unknown"),
      toolArgs,
    });
  }
  return out;
}

/** Collect tool call IDs that already have results in the thread. */
function getToolCallIdsWithResults(thread: AgentInputItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of thread as Array<Record<string, unknown>>) {
    if (item.type !== "function_call_result") continue;
    if (item.callId) ids.add(String(item.callId));
  }
  return ids;
}

/** First tool call that doesn't have a result yet (next to ask approval for). */
function getNextToolCallNeedingApproval(
  thread: AgentInputItem[],
): ToolCallFullInfo | null {
  const withResults = getToolCallIdsWithResults(thread);
  for (const tc of collectToolCalls(thread)) {
    if (!withResults.has(tc.toolCallId)) return tc;
  }
  return null;
}

export interface ChatHandlerDeps {
  context: ContextStore;
  auditLog: AuditLog;
  publishResponse: (payload: ResponseDeliveryPayload) => void;
  getRunner: () => Promise<HoomanRunner>;
  runAgent: RunAgentFn;
  attachmentService: AttachmentService;
  toolSettingsStore?: ToolSettingsStore;
  invalidateRunnerCache?: () => void;
}

function publishApiProgress(
  publishResponse: ChatHandlerDeps["publishResponse"],
  source: string,
  eventId: string,
  stage: ChatProgressStage,
  delta?: string,
): void {
  if (source !== "api" && source !== "web") return;
  if (source === "api") {
    publishResponse({
      channel: "api",
      eventId,
      progress: {
        stage,
        ...(typeof delta === "string" && delta.length > 0 ? { delta } : {}),
        ...(stage === "done" ? { done: true } : {}),
      },
    });
    return;
  }
  publishResponse({
    channel: "web",
    eventId,
    progress: {
      stage,
      ...(typeof delta === "string" && delta.length > 0 ? { delta } : {}),
      ...(stage === "done" ? { done: true } : {}),
    },
  });
}

function stageLabel(stage: ChatProgressStage): string {
  switch (stage) {
    case "searching":
      return "Searching...";
    case "organizing":
      return "Organizing...";
    case "writing":
      return "Writing...";
    case "awaiting_approval":
      return "Awaiting approval...";
    case "done":
      return "Done";
    case "thinking":
    default:
      return "Thinking...";
  }
}

function publishSlackStatus(
  publishResponse: ChatHandlerDeps["publishResponse"],
  channelMeta: ChannelMeta | undefined,
  stage: ChatProgressStage,
): void {
  if (!channelMeta || channelMeta.channel !== "slack") return;
  const channelId = channelMeta.message?.channel?.id;
  if (!channelId) return;
  const threadTs = slackConversationThreadTs(channelMeta);
  publishResponse({
    channel: "slack",
    channelId,
    threadTs,
    status: {
      stage,
      label: stageLabel(stage),
      ...(stage === "done" ? { done: true } : {}),
    },
  });
}

function createApiRunCallbacks(
  publishResponse: ChatHandlerDeps["publishResponse"],
  eventId: string,
  source: string,
): RunStreamCallbacks | undefined {
  if (source !== "api" && source !== "web") return undefined;
  return {
    onStage: async (stage) => {
      publishApiProgress(publishResponse, source, eventId, stage);
    },
    onTextDelta: async (delta) => {
      publishApiProgress(publishResponse, source, eventId, "writing", delta);
    },
  };
}

function createSlackRunCallbacks(
  publishResponse: ChatHandlerDeps["publishResponse"],
  source: string,
  channelMeta: ChannelMeta | undefined,
): RunStreamCallbacks | undefined {
  if (source !== "slack") return undefined;
  if (!channelMeta || channelMeta.channel !== "slack") return undefined;
  if ((channelMeta.connectAs ?? "bot") !== "bot") return undefined;
  return {
    onStage: async (stage) => {
      publishSlackStatus(publishResponse, channelMeta, stage);
    },
  };
}

async function runAgentWithSignals(
  deps: ChatHandlerDeps,
  params: {
    event: NormalizedEvent;
    history: AgentInputItem[];
    text: string | string[];
    runOptions: RunChatOptions;
    timeoutMs: number;
  },
): Promise<RunChatResult> {
  const apiCallbacks = createApiRunCallbacks(
    deps.publishResponse,
    params.event.id,
    params.event.source,
  );
  const slackCallbacks = createSlackRunCallbacks(
    deps.publishResponse,
    params.event.source,
    params.runOptions.channel as ChannelMeta | undefined,
  );
  const callbacks = apiCallbacks ?? slackCallbacks;
  return await deps.runAgent(
    params.history,
    params.text,
    params.runOptions,
    params.timeoutMs,
    callbacks,
  );
}

export function createChatHandler(
  deps: ChatHandlerDeps,
): (event: NormalizedEvent) => Promise<void> {
  const { context, auditLog, publishResponse } = deps;

  const dispatchResponse = (
    eventId: string,
    source: string,
    channelMeta: ChannelMeta | undefined,
    text: string,
    approvalRequest?: { toolName: string; argsPreview: string },
  ) =>
    dispatch(
      publishResponse,
      eventId,
      source,
      channelMeta,
      text,
      approvalRequest,
    );

  return async (event: NormalizedEvent) => {
    if (event.payload.kind !== "message") return;

    const {
      text,
      userId,
      attachments: savedAttachments,
      channelMeta,
      sourceMessageType,
    } = event.payload;
    const channelKey = channelKeyFromMeta(
      channelMeta as ChannelMeta | undefined,
    );
    const attachmentPaths =
      savedAttachments?.length && deps.attachmentService
        ? await resolveSavedAttachmentsToPaths(
            deps.attachmentService,
            userId,
            savedAttachments,
          )
        : undefined;
    const runOptions: RunChatOptions = {
      source: event.source,
      channel: channelMeta as ChannelMeta | undefined,
      attachments: attachmentPaths,
      sessionId: userId,
    };
    const chatTimeoutMs =
      getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;

    await logIncomingMessage(
      auditLog,
      event,
      userId,
      text,
      channelMeta,
      sourceMessageType,
    );
    debug("Processing message eventId=%s userId=%s", event.id, userId);
    debug(
      "Normalized payload to runner: %s",
      JSON.stringify(
        {
          text,
          userId,
          attachments: savedAttachments,
          channelMeta,
          sourceMessageType,
        },
        null,
        2,
      ),
    );

    const payload = event.payload as NormalizedMessagePayload;
    const pending = await getPending(userId, channelKey);
    if (pending) {
      const handled = await handlePendingApproval(deps, {
        event,
        payload,
        channelKey,
        runOptions,
        chatTimeoutMs,
        pending,
        dispatchResponse,
      });
      if (handled) return;
    }

    try {
      const thread = await context.getThreadForAgent(userId);
      const result = await runAgentWithSignals(deps, {
        event,
        history: thread,
        text,
        runOptions,
        timeoutMs: chatTimeoutMs,
      });

      if (result.needsApproval) {
        await handleNeedsApproval(deps, {
          event,
          payload,
          channelKey,
          runOptions,
          result,
          dispatchResponse,
        });
        return;
      }

      await handleAgentSuccess(deps, {
        event,
        payload,
        result,
        dispatchResponse,
      });
    } catch (err) {
      await handleChatError(deps, {
        event,
        payload,
        err,
        dispatchResponse,
      });
    }
  };
}

async function logIncomingMessage(
  auditLog: AuditLog,
  event: NormalizedEvent,
  userId: string,
  text: string | string[],
  channelMeta: ChannelMeta | undefined,
  sourceMessageType?: "audio",
): Promise<void> {
  const textCombined = toCombinedText(text);
  await auditLog.appendAuditEntry({
    type: "incoming_message",
    payload: {
      source: event.source,
      userId,
      textPreview:
        textCombined.length > 100
          ? `${textCombined.slice(0, 100)}…`
          : textCombined,
      channel: (channelMeta as { channel?: string } | undefined)?.channel,
      eventId: event.id,
      ...(sourceMessageType ? { sourceMessageType } : {}),
    },
  });
}

interface PendingApprovalCtx {
  event: NormalizedEvent;
  payload: NormalizedMessagePayload;
  channelKey: string | undefined;
  runOptions: RunChatOptions;
  chatTimeoutMs: number;
  pending: PendingApproval;
  dispatchResponse: (
    eventId: string,
    source: string,
    channelMeta: ChannelMeta | undefined,
    text: string,
    approvalRequest?: { toolName: string; argsPreview: string },
  ) => void | Promise<void>;
}

async function handlePendingApproval(
  deps: ChatHandlerDeps,
  ctx: PendingApprovalCtx,
): Promise<boolean> {
  const { event, payload, channelKey, pending, dispatchResponse } = ctx;
  const { auditLog } = deps;

  debug(
    "Pending approval found eventId=%s userId=%s toolName=%s",
    event.id,
    payload.userId,
    pending.toolName,
  );

  const reply = await parsePendingReply(toLatestText(payload.text), pending);
  if (reply === "reject") {
    const consumed = await consumePending(payload.userId, channelKey);
    debug(
      "Approval rejected eventId=%s userId=%s toolName=%s",
      event.id,
      payload.userId,
      pending.toolName,
    );
    await auditLog.appendAuditEntry({
      type: "approval_rejected",
      payload: {
        userId: payload.userId,
        eventId: event.id,
        toolName: pending.toolName,
      },
    });
    if (!consumed) {
      await dispatchResponse(
        event.id,
        event.source,
        ctx.runOptions.channel as ChannelMeta | undefined,
        "Approval expired. You can try again.",
      );
      return true;
    }
    await handleApprovalReject(deps, { ...ctx, consumed } as ApprovalRejectCtx);
    return true;
  }

  if (reply === "none") {
    debug(
      "Pending cleared (reply=none), treating as new message eventId=%s",
      event.id,
    );
    await clearPending(payload.userId, channelKey);
    return false;
  }

  if (reply === "confirm" || reply === "allow_every_time") {
    await handleApprovalConfirm(deps, ctx, reply);
    return true;
  }

  return false;
}

async function parsePendingReply(
  text: string,
  pending: PendingApproval,
): Promise<ConfirmationResult> {
  const toolApprovalMode = getConfig().TOOL_APPROVAL_MODE ?? "llm";
  if (toolApprovalMode === "llm") {
    try {
      const label = await parseApprovalReplyWithLlm(
        text,
        pending.toolName,
        pending.approvalMessage,
      );
      return approvalReplyLabelToResult(label);
    } catch {
      return "none";
    }
  }
  return parseConfirmationReply(text);
}

interface ApprovalRejectCtx extends PendingApprovalCtx {
  consumed: PendingApproval;
}

async function handleApprovalReject(
  deps: ChatHandlerDeps,
  ctx: ApprovalRejectCtx,
): Promise<void> {
  const {
    event,
    payload,
    channelKey,
    runOptions,
    chatTimeoutMs,
    consumed,
    dispatchResponse,
  } = ctx;
  const { context } = deps;

  let thread: AgentInputItem[];
  try {
    thread = JSON.parse(consumed.threadSnapshotJson) as AgentInputItem[];
  } catch {
    thread = [];
  }
  const deniedToolCallId =
    (consumed as { toolCallId?: string }).toolCallId ?? `call_${Date.now()}`;
  const toolResultMessage = {
    type: "function_call_result",
    callId: deniedToolCallId,
    name: consumed.toolName,
    status: "completed",
    output: "Execution denied by user.",
  } as AgentInputItem;
  thread.push(toolResultMessage);
  await context.addTurnToAgentThread(payload.userId, [toolResultMessage]);

  const nextTool = getNextToolCallNeedingApproval(thread);
  if (nextTool) {
    await requestApprovalForTool(deps, {
      event,
      payload,
      channelKey,
      runOptions,
      toolName: nextTool.toolName,
      toolArgs: nextTool.toolArgs,
      toolCallId: nextTool.toolCallId,
      thread,
      historyLength: consumed.historyLength,
      dispatchResponse,
    });
    return;
  }

  // All tools in this assistant message now have a result (approved or rejected). Run agent once to produce final response using all results.
  try {
    const result = await runAgentWithSignals(deps, {
      event,
      history: thread,
      text: "User denied one or more tools. Use the tool results for any tools that were approved; for any that were denied, say the user declined that check.",
      runOptions,
      timeoutMs: chatTimeoutMs,
    });

    if (result.needsApproval) {
      await handleNeedsApproval(deps, {
        event,
        payload,
        channelKey,
        runOptions,
        result,
        dispatchResponse,
      });
      return;
    }

    const assistantText = result.output?.trim() || "I didn't run that tool.";
    await context.addTurnToChatHistory(
      payload.userId,
      toCombinedText(payload.text),
      assistantText,
      {
        userAttachments: payload.attachments?.map((a) => a.id),
      },
    );
    await dispatchResponse(
      event.id,
      event.source,
      runOptions.channel as ChannelMeta | undefined,
      assistantText,
    );

    const runMessages = result.messages ?? [];
    if (runMessages.length) {
      await context.addTurnToAgentThread(payload.userId, runMessages);
    } else {
      await context.addTurnToAgentThread(payload.userId, [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: toCombinedText(payload.text) }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: assistantText }],
        },
      ] as AgentInputItem[]);
    }
  } catch (err) {
    const msg = (err as Error).message;
    const assistantText = `Something went wrong: ${msg}. Check API logs.`;
    await context.addTurnToChatHistory(
      payload.userId,
      toCombinedText(payload.text),
      assistantText,
      {
        userAttachments: payload.attachments?.map((a) => a.id),
      },
    );
    await dispatchResponse(
      event.id,
      event.source,
      runOptions.channel as ChannelMeta | undefined,
      assistantText,
    );
  }
}

async function handleApprovalConfirm(
  deps: ChatHandlerDeps,
  ctx: PendingApprovalCtx,
  reply: "confirm" | "allow_every_time",
): Promise<void> {
  const {
    event,
    payload,
    channelKey,
    runOptions,
    chatTimeoutMs,
    dispatchResponse,
  } = ctx;
  const { context, auditLog, getRunner } = deps;

  const consumed = await consumePending(payload.userId, channelKey);
  if (!consumed) {
    debug("Approval expired or already consumed eventId=%s", event.id);
    await dispatchResponse(
      event.id,
      event.source,
      runOptions.channel as ChannelMeta | undefined,
      "Approval expired. You can try again.",
    );
    return;
  }

  if (
    reply === "allow_every_time" &&
    deps.toolSettingsStore &&
    consumed.toolName
  ) {
    const toolId =
      (consumed as { toolId?: string }).toolId ?? consumed.toolName;
    await deps.toolSettingsStore.setAllowEveryTime(toolId, true);
    deps.invalidateRunnerCache?.();
    await auditLog.appendAuditEntry({
      type: "approval_allow_every_time",
      payload: { userId: payload.userId, toolId, toolName: consumed.toolName },
    });
  } else if (reply === "confirm") {
    await auditLog.appendAuditEntry({
      type: "approval_confirmed",
      payload: {
        userId: payload.userId,
        eventId: event.id,
        toolName: consumed.toolName,
      },
    });
  }

  debug(
    "Approval %s eventId=%s userId=%s toolName=%s",
    reply,
    event.id,
    payload.userId,
    consumed.toolName,
  );

  try {
    let thread: AgentInputItem[];
    try {
      thread = JSON.parse(consumed.threadSnapshotJson) as AgentInputItem[];
    } catch {
      thread = [];
    }
    const runner = await getRunner();
    const toolResult = await runner.executeTool(
      consumed.toolName,
      consumed.toolArgs,
    );
    const executedToolCallId =
      (consumed as { toolCallId?: string }).toolCallId ?? `call_${Date.now()}`;
    const toolResultMessage = {
      type: "function_call_result",
      callId: executedToolCallId,
      name: consumed.toolName,
      status: "completed",
      output:
        typeof toolResult === "string"
          ? toolResult
          : JSON.stringify(toolResult ?? {}),
    } as AgentInputItem;
    thread.push(toolResultMessage);
    await context.addTurnToAgentThread(payload.userId, [toolResultMessage]);

    const nextTool = getNextToolCallNeedingApproval(thread);
    if (nextTool) {
      await requestApprovalForTool(deps, {
        event,
        payload,
        channelKey,
        runOptions,
        toolName: nextTool.toolName,
        toolArgs: nextTool.toolArgs,
        toolCallId: nextTool.toolCallId,
        thread,
        historyLength: consumed.historyLength,
        dispatchResponse,
      });
      return;
    }

    // All tools in this assistant message now have a result (approved or rejected). Run agent once to produce final response using all results.
    const result = await runAgentWithSignals(deps, {
      event,
      history: thread,
      text: "",
      runOptions,
      timeoutMs: chatTimeoutMs,
    });

    if (result.needsApproval) {
      await handleNeedsApproval(deps, {
        event,
        payload,
        channelKey,
        runOptions,
        result,
        dispatchResponse,
      });
      return;
    }

    const assistantText = result.output?.trim() || "Done.";
    await context.addTurnToChatHistory(
      payload.userId,
      toCombinedText(payload.text),
      assistantText,
      {
        userAttachments: payload.attachments?.map((a) => a.id),
      },
    );
    await dispatchResponse(
      event.id,
      event.source,
      runOptions.channel as ChannelMeta | undefined,
      assistantText,
    );

    const runMessages = result.messages ?? [];
    if (runMessages.length) {
      await context.addTurnToAgentThread(payload.userId, runMessages);
    } else {
      await context.addTurnToAgentThread(payload.userId, [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: toCombinedText(payload.text) }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: assistantText }],
        },
      ] as AgentInputItem[]);
    }
  } catch (err) {
    const msg = (err as Error).message;
    debug(
      "Tool execution failed after approval eventId=%s userId=%s toolName=%s: %o",
      event.id,
      payload.userId,
      consumed.toolName,
      err,
    );
    await auditLog.appendAuditEntry({
      type: "approval_tool_execution_failed",
      payload: {
        eventId: event.id,
        userId: payload.userId,
        toolName: consumed.toolName,
        error: msg,
      },
    });
    const assistantText = `Tool execution failed: ${msg}. Check API logs.`;
    await dispatchResponse(
      event.id,
      event.source,
      runOptions.channel as ChannelMeta | undefined,
      assistantText,
    );
  }
}

/** Request approval for a specific tool (used in sequential approval chain). Does not persist to agent thread. */
async function requestApprovalForTool(
  deps: ChatHandlerDeps,
  ctx: {
    event: NormalizedEvent;
    payload: NormalizedMessagePayload;
    channelKey: string | undefined;
    runOptions: RunChatOptions;
    toolName: string;
    toolArgs: unknown;
    toolCallId: string;
    thread: AgentInputItem[];
    historyLength?: number;
    dispatchResponse: (
      eventId: string,
      source: string,
      channelMeta: ChannelMeta | undefined,
      text: string,
      approvalRequest?: { toolName: string; argsPreview: string },
    ) => void | Promise<void>;
  },
): Promise<void> {
  const {
    event,
    payload,
    channelKey,
    runOptions,
    toolName,
    toolArgs,
    toolCallId,
    thread,
    historyLength,
    dispatchResponse,
  } = ctx;
  const { auditLog, context } = deps;

  const raw =
    typeof toolArgs === "object" ? JSON.stringify(toolArgs) : String(toolArgs);
  const argsPreview = raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
  await auditLog.appendAuditEntry({
    type: "approval_requested",
    payload: {
      toolName,
      toolArgsPreview: argsPreview,
      userId: payload.userId,
      channel: (runOptions.channel as { channel?: string } | undefined)
        ?.channel,
      eventId: event.id,
    },
  });

  const channel =
    (
      runOptions.channel as
        | { channel?: "api" | "slack" | "whatsapp" }
        | undefined
    )?.channel ?? event.source;
  const channelTyped = channel as "api" | "slack" | "whatsapp";
  const toolApprovalMode = getConfig().TOOL_APPROVAL_MODE ?? "llm";
  const useLlmForApproval =
    channelTyped !== "api" && toolApprovalMode === "llm";
  const approvalMessage = useLlmForApproval
    ? await formatApprovalMessageWithLlm(channelTyped, toolName, argsPreview)
    : formatApprovalMessage(channelTyped, toolName, argsPreview);

  await setPending(
    payload.userId,
    {
      userId: payload.userId,
      channelMeta: runOptions.channel,
      eventId: event.id,
      toolName,
      toolArgs,
      threadSnapshotJson: JSON.stringify(thread),
      historyLength,
      approvalMessage,
      toolCallId,
      toolId: toolName,
    },
    channelKey,
  );

  const approvalRequest = { toolName, argsPreview };
  await dispatchResponse(
    event.id,
    event.source,
    runOptions.channel as ChannelMeta | undefined,
    approvalMessage,
    event.source === "api" || event.source === "web"
      ? approvalRequest
      : undefined,
  );
  await context.addTurnToChatHistory(
    payload.userId,
    toCombinedText(payload.text),
    approvalMessage,
    {
      userAttachments: payload.attachments?.map((a) => a.id),
      approvalRequest:
        event.source === "api" || event.source === "web"
          ? approvalRequest
          : undefined,
    },
  );
}

interface NeedsApprovalCtx {
  event: NormalizedEvent;
  payload: NormalizedMessagePayload;
  channelKey: string | undefined;
  runOptions: RunChatOptions;
  result: RunChatResult;
  dispatchResponse: (
    eventId: string,
    source: string,
    channelMeta: ChannelMeta | undefined,
    text: string,
    approvalRequest?: { toolName: string; argsPreview: string },
  ) => void | Promise<void>;
}

async function handleNeedsApproval(
  deps: ChatHandlerDeps,
  ctx: NeedsApprovalCtx,
): Promise<void> {
  const { event, payload, channelKey, runOptions, result, dispatchResponse } =
    ctx;
  const { context, auditLog } = deps;

  const needsApproval = result.needsApproval!;
  debug(
    "Needs approval eventId=%s userId=%s toolName=%s",
    event.id,
    payload.userId,
    needsApproval.toolName,
  );

  const raw =
    typeof needsApproval.toolArgs === "object"
      ? JSON.stringify(needsApproval.toolArgs)
      : String(needsApproval.toolArgs);
  const argsPreview = raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
  await auditLog.appendAuditEntry({
    type: "approval_requested",
    payload: {
      toolName: needsApproval.toolName,
      toolArgsPreview: argsPreview,
      userId: payload.userId,
      channel: (runOptions.channel as { channel?: string } | undefined)
        ?.channel,
      eventId: event.id,
    },
  });

  const channel =
    (
      runOptions.channel as
        | { channel?: "api" | "slack" | "whatsapp" }
        | undefined
    )?.channel ?? event.source;
  const channelTyped = channel as "api" | "slack" | "whatsapp";
  const toolApprovalMode = getConfig().TOOL_APPROVAL_MODE ?? "llm";
  const useLlmForApproval =
    channelTyped !== "api" && toolApprovalMode === "llm";
  const approvalMessage = useLlmForApproval
    ? await formatApprovalMessageWithLlm(
        channelTyped,
        needsApproval.toolName,
        argsPreview,
      )
    : formatApprovalMessage(channelTyped, needsApproval.toolName, argsPreview);

  const turnToPersist =
    typeof needsApproval.historyLength === "number" &&
    needsApproval.historyLength >= 0
      ? needsApproval.threadSnapshot.slice(needsApproval.historyLength)
      : needsApproval.threadSnapshot;
  if (turnToPersist.length) {
    await context.addTurnToAgentThread(payload.userId, turnToPersist);
  }

  await setPending(
    payload.userId,
    {
      userId: payload.userId,
      channelMeta: runOptions.channel,
      eventId: event.id,
      toolName: needsApproval.toolName,
      toolArgs: needsApproval.toolArgs,
      threadSnapshotJson: JSON.stringify(needsApproval.threadSnapshot),
      historyLength: needsApproval.historyLength,
      approvalMessage,
      ...(needsApproval.toolCallId
        ? { toolCallId: needsApproval.toolCallId }
        : {}),
      ...(needsApproval.toolId ? { toolId: needsApproval.toolId } : {}),
    },
    channelKey,
  );

  const approvalRequest = { toolName: needsApproval.toolName, argsPreview };
  const channelMeta = runOptions.channel as ChannelMeta | undefined;
  if (event.source === "slack" && channelMeta?.channel === "slack") {
    publishSlackStatus(deps.publishResponse, channelMeta, "done");
  }
  await dispatchResponse(
    event.id,
    event.source,
    channelMeta,
    approvalMessage,
    event.source === "api" || event.source === "web"
      ? approvalRequest
      : undefined,
  );
  await context.addTurnToChatHistory(
    payload.userId,
    toCombinedText(payload.text),
    approvalMessage,
    {
      userAttachments: payload.attachments?.map((a) => a.id),
      approvalRequest:
        event.source === "api" || event.source === "web"
          ? approvalRequest
          : undefined,
    },
  );
}

interface AgentSuccessCtx {
  event: NormalizedEvent;
  payload: NormalizedMessagePayload;
  result: RunChatResult;
  dispatchResponse: (
    eventId: string,
    source: string,
    channelMeta: ChannelMeta | undefined,
    text: string,
  ) => void | Promise<void>;
}

async function handleAgentSuccess(
  deps: ChatHandlerDeps,
  ctx: AgentSuccessCtx,
): Promise<void> {
  const { event, payload, result, dispatchResponse } = ctx;
  const { context, auditLog } = deps;

  const assistantText =
    result.output?.trim() ||
    "I didn't get a clear response. Try rephrasing or check your API key and model settings.";

  auditLog.emitResponse({
    type: "response",
    text: assistantText,
    eventId: event.id,
    userInput: toCombinedText(payload.text),
  });
  await context.addTurnToChatHistory(
    payload.userId,
    toCombinedText(payload.text),
    assistantText,
    {
      userAttachments: payload.attachments?.map((a) => a.id),
    },
  );
  debug(
    "Dispatching response eventId=%s len=%d",
    event.id,
    assistantText.length,
  );
  await dispatchResponse(
    event.id,
    event.source,
    payload.channelMeta ?? undefined,
    assistantText,
  );

  const messages = result.messages;
  if (messages?.length) {
    await context.addTurnToAgentThread(payload.userId, messages);
  } else {
    await context.addTurnToAgentThread(payload.userId, [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: toCombinedText(payload.text) }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: assistantText }],
      },
    ] as AgentInputItem[]);
  }
}

interface ChatErrorCtx {
  event: NormalizedEvent;
  payload: NormalizedMessagePayload;
  err: unknown;
  dispatchResponse: (
    eventId: string,
    source: string,
    channelMeta: ChannelMeta | undefined,
    text: string,
  ) => void | Promise<void>;
}

async function handleChatError(
  deps: ChatHandlerDeps,
  ctx: ChatErrorCtx,
): Promise<void> {
  const { event, payload, err, dispatchResponse } = ctx;
  const { context } = deps;

  // Clear Slack "Finding answers..." / "Evaluating..." status on error so the UI doesn't stay stuck.
  if (event.source === "slack" && payload.channelMeta?.channel === "slack") {
    try {
      publishSlackStatus(deps.publishResponse, payload.channelMeta, "done");
    } catch (e) {
      debug("Failed to clear Slack status on error: %o", e);
    }
  }

  const chatTimeoutMs = getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;

  let assistantText: string;
  if (err instanceof ChatTimeoutError) {
    debug("Chat timed out after %s ms", chatTimeoutMs);
    assistantText =
      "This is taking longer than expected. The agent may be using a tool. You can try again or rephrase.";
  } else {
    const msg = (err as Error).message;
    assistantText = `Something went wrong: ${msg}. Check API logs.`;
    debug("Chat handler error eventId=%s: %o", event.id, err);
  }

  await context.addTurnToChatHistory(
    payload.userId,
    toCombinedText(payload.text),
    assistantText,
    {
      userAttachments: payload.attachments?.map((a) => a.id),
    },
  );
  debug("Dispatching error response eventId=%s", event.id);
  await dispatchResponse(
    event.id,
    event.source,
    payload.channelMeta ?? undefined,
    assistantText,
  );
  await context.addTurnToAgentThread(payload.userId, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: toCombinedText(payload.text) }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: assistantText }],
    },
  ] as AgentInputItem[]);
}
