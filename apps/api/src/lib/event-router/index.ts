import createDebug from "debug";
import type {
  RawDispatchInput,
  NormalizedEvent,
  NormalizedPayload,
} from "../types/index.js";
import { randomUUID } from "crypto";

const debug = createDebug("hooman:event-router");

export type EventHandler = (event: NormalizedEvent) => void | Promise<void>;

const DEFAULT_PRIORITY: Record<string, number> = {
  "message.sent": 10,
  "task.scheduled": 5,
  internal: 8,
};

const seenEventKeys = new Set<string>();
const DEDUP_TTL_MS = 60_000;

function eventKey(e: NormalizedEvent): string {
  return `${e.source}:${e.type}:${JSON.stringify(e.payload)}`;
}

function normalizePriority(raw: RawDispatchInput): number {
  if (raw.priority != null) return raw.priority;
  return DEFAULT_PRIORITY[raw.type] ?? 5;
}

/**
 * Normalize raw dispatch input into a canonical payload shape (PRD §8).
 * All handlers receive NormalizedEvent so sources (UI, API, MCP, scheduler) are handled uniformly.
 */
function normalizePayload(
  source: RawDispatchInput["source"],
  type: string,
  payload: Record<string, unknown>,
): NormalizedPayload {
  if (type === "message.sent") {
    const text = typeof payload.text === "string" ? payload.text : "";
    const userId =
      typeof payload.userId === "string" ? payload.userId : "default";
    const attachments = Array.isArray(payload.attachments)
      ? (
          payload.attachments as Array<{
            name: string;
            contentType: string;
            data: string;
          }>
        ).filter(
          (a) =>
            typeof a?.name === "string" &&
            typeof a?.contentType === "string" &&
            typeof a?.data === "string",
        )
      : undefined;
    const attachment_ids = Array.isArray(payload.attachment_ids)
      ? (payload.attachment_ids as string[]).filter(
          (id) => typeof id === "string",
        )
      : undefined;
    return { kind: "message", text, userId, attachments, attachment_ids };
  }
  if (type === "task.scheduled") {
    const execute_at =
      typeof payload.execute_at === "string" ? payload.execute_at : "";
    const intent = typeof payload.intent === "string" ? payload.intent : "";
    const context =
      payload.context && typeof payload.context === "object"
        ? (payload.context as Record<string, unknown>)
        : {};
    return { kind: "scheduled_task", execute_at, intent, context };
  }
  if (type === "chat.turn_completed") {
    return { kind: "internal", data: payload };
  }
  // Future: MCP/integration events → kind: "integration_event"
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
  // Unknown: wrap as internal
  return { kind: "internal", data: payload };
}

export class EventRouter {
  private handlers: EventHandler[] = [];
  private queue: NormalizedEvent[] = [];
  private processing = false;

  register(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /**
   * Dispatch a raw event. It is normalized (payload shape), deduped, prioritized, then sent to all handlers.
   */
  async dispatch(
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ): Promise<string> {
    const id = options?.correlationId ?? randomUUID();
    const timestamp = new Date().toISOString();
    const priority = normalizePriority(raw);
    const payload = normalizePayload(raw.source, raw.type, raw.payload);

    const event: NormalizedEvent = {
      id,
      source: raw.source,
      type: raw.type,
      payload,
      timestamp,
      priority,
    };

    const key = eventKey(event);
    if (seenEventKeys.has(key)) return id;
    seenEventKeys.add(key);
    setTimeout(() => seenEventKeys.delete(key), DEDUP_TTL_MS);

    this.queue.push(event);
    this.queue.sort((a, b) => b.priority - a.priority);
    await this.processQueue();
    return id;
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      for (const handler of this.handlers) {
        try {
          await handler(event);
        } catch (err) {
          debug("handler error: %o", err);
        }
      }
    }
    this.processing = false;
  }
}
