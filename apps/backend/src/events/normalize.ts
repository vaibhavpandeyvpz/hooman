/**
 * Event normalisation: raw dispatch input → NormalizedEvent.
 * Shared by API and workers so any process can enqueue directly.
 */
import type {
  RawDispatchInput,
  NormalizedEvent,
  NormalizedPayload,
  ChannelMeta,
  SlackChannelMeta,
  WhatsAppChannelMeta,
} from "../types.js";

function parseChannelMeta(raw: unknown): ChannelMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as ChannelMeta;
  if (c.channel === "slack") {
    const s = c as SlackChannelMeta;
    if (
      s.message?.channel?.id &&
      s.profile &&
      typeof s.profile.id === "string" &&
      typeof s.message.replyInThread === "boolean"
    )
      return s;
    return undefined;
  }
  if (c.channel === "whatsapp") {
    const w = c as WhatsAppChannelMeta;
    if (
      w.message?.chat?.id &&
      typeof w.message.id === "string" &&
      w.profile &&
      typeof w.profile.id === "string"
    )
      return w;
    return undefined;
  }
  return undefined;
}
import { randomUUID } from "crypto";

const DEFAULT_PRIORITY: Record<string, number> = {
  "message.sent": 10,
  "task.scheduled": 5,
  internal: 8,
};

export function normalizePriority(raw: RawDispatchInput): number {
  if (raw.priority != null) return raw.priority;
  return DEFAULT_PRIORITY[raw.type] ?? 5;
}

/**
 * Normalize raw dispatch input into a canonical payload shape (PRD §8).
 */
export function normalizePayload(
  source: RawDispatchInput["source"],
  type: string,
  payload: Record<string, unknown>,
): NormalizedPayload {
  if (type === "message.sent") {
    const text = Array.isArray(payload.text)
      ? (payload.text as unknown[])
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : typeof payload.text === "string"
        ? payload.text
        : "";
    const userId =
      typeof payload.userId === "string" ? payload.userId : "default";
    const attachments = Array.isArray(payload.attachments)
      ? (
          payload.attachments as Array<{
            id: string;
            originalName: string;
            mimeType: string;
          }>
        ).filter(
          (a) =>
            typeof a?.id === "string" &&
            typeof a?.originalName === "string" &&
            typeof a?.mimeType === "string",
        )
      : undefined;
    const channelMeta = parseChannelMeta(payload.channelMeta);
    const sourceMessageType =
      payload.sourceMessageType === "audio" ? ("audio" as const) : undefined;
    const blocksSummary =
      typeof payload.blocksSummary === "string" && payload.blocksSummary.trim()
        ? payload.blocksSummary.trim()
        : undefined;
    return {
      kind: "message",
      text,
      userId,
      ...(attachments?.length ? { attachments } : {}),
      ...(channelMeta ? { channelMeta } : {}),
      ...(sourceMessageType ? { sourceMessageType } : {}),
      ...(blocksSummary ? { blocksSummary } : {}),
    };
  }
  if (type === "task.scheduled") {
    const execute_at =
      typeof payload.execute_at === "string" && payload.execute_at.trim() !== ""
        ? payload.execute_at.trim()
        : undefined;
    const intent = typeof payload.intent === "string" ? payload.intent : "";
    const context =
      payload.context && typeof payload.context === "object"
        ? (payload.context as Record<string, unknown>)
        : {};
    const cron =
      typeof payload.cron === "string" && payload.cron.trim() !== ""
        ? payload.cron.trim()
        : undefined;
    return {
      kind: "scheduled_task",
      intent,
      context,
      ...(execute_at !== undefined ? { execute_at } : {}),
      ...(cron ? { cron } : {}),
    };
  }
  if (type === "chat.turn_completed") {
    return { kind: "internal", data: payload };
  }
  if (
    source === "mcp" &&
    typeof payload.integrationId === "string" &&
    typeof payload.originalType === "string"
  ) {
    return {
      kind: "integration_event",
      integrationId: payload.integrationId as string,
      originalType: payload.originalType as string,
      payload: (payload.payload as Record<string, unknown>) ?? {},
    };
  }
  return { kind: "internal", data: payload };
}

export function eventKey(e: NormalizedEvent): string {
  return `${e.source}:${e.type}:${JSON.stringify(e.payload)}`;
}

export function createNormalizedEvent(
  raw: RawDispatchInput,
  options?: { correlationId?: string },
): NormalizedEvent {
  const id = options?.correlationId ?? randomUUID();
  const timestamp = new Date().toISOString();
  const priority = normalizePriority(raw);
  const payload = normalizePayload(raw.source, raw.type, raw.payload);
  return {
    id,
    source: raw.source,
    type: raw.type,
    payload,
    timestamp,
    priority,
  };
}
