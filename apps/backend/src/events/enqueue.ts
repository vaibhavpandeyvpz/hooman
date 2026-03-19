/**
 * Shared enqueue: normalize raw input and add to queue. Used by API and workers
 * so all producers push events directly to BullMQ.
 */
import type { RawDispatchInput, EventDispatcher } from "../types.js";
import { createNormalizedEvent, eventKey } from "./normalize.js";
import type { EventQueueAdapter } from "./event-queue.js";
import { Queue, Worker } from "bullmq";
import createDebug from "debug";

const debug = createDebug("hooman:enqueue");
const DEBOUNCE_QUEUE_NAME = "hooman-events-debounce";

interface DebounceOptions {
  connection: string;
  windowsMs: Partial<Record<RawDispatchInput["source"], number>>;
}

interface DebouncedQueueJob {
  raw: RawDispatchInput;
  payloads: Record<string, unknown>[];
}

export type QueueDispatcher = EventDispatcher & {
  close?: () => Promise<void>;
};

function connectionFromUrl(redisUrl: string): {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
} {
  const u = new URL(redisUrl);
  return {
    host: u.hostname || "localhost",
    port: u.port ? parseInt(u.port, 10) : 6379,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export async function enqueueRaw(
  queue: EventQueueAdapter,
  raw: RawDispatchInput,
  options?: {
    correlationId?: string;
    dedupSet?: Set<string>;
  },
): Promise<string> {
  const event = createNormalizedEvent(raw, {
    correlationId: options?.correlationId,
  });
  // When correlationId is set (e.g. API chat), treat each request as unique so every message is enqueued.
  const key =
    options?.correlationId != null
      ? `${event.source}:${event.type}:${event.id}`
      : eventKey(event);
  if (options?.dedupSet?.has(key)) return event.id;
  options?.dedupSet?.add(key);
  const id = await queue.add(event);
  return id;
}

function computeDebounceKey(raw: RawDispatchInput): string | null {
  if (raw.type !== "message.sent") return null;
  if (raw.source !== "slack" && raw.source !== "whatsapp") return null;
  const payload = raw.payload as Record<string, unknown>;
  const userId =
    typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (userId) return `${raw.source}:${userId}`;

  const channelMeta =
    payload.channelMeta && typeof payload.channelMeta === "object"
      ? (payload.channelMeta as Record<string, unknown>)
      : undefined;
  if (raw.source === "slack") {
    const msg = channelMeta?.message as
      | { channel?: { id?: string }; parent?: { messageTs?: string } }
      | undefined;
    const channelId =
      typeof msg?.channel?.id === "string" ? msg.channel.id : "";
    const threadTs =
      typeof msg?.parent?.messageTs === "string" ? msg.parent.messageTs : "";
    if (channelId) return `slack:${channelId}:${threadTs || "root"}`;
  }
  if (raw.source === "whatsapp") {
    const msg = channelMeta?.message as { chat?: { id?: string } } | undefined;
    const chatId = typeof msg?.chat?.id === "string" ? msg.chat.id : "";
    if (chatId) return `whatsapp:${chatId}`;
  }
  return `${raw.source}:default`;
}

function mergeMessagePayloads(
  latestPayload: Record<string, unknown>,
  payloads: Record<string, unknown>[],
): Record<string, unknown> {
  const merged = { ...latestPayload };
  const text = payloads
    .flatMap((p) =>
      Array.isArray(p.text)
        ? p.text
        : typeof p.text === "string"
          ? [p.text]
          : [],
    )
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (text.length > 0) merged.text = text;

  const attachmentLists = payloads.flatMap((p) =>
    Array.isArray(p.attachments) ? p.attachments : [],
  );
  if (attachmentLists.length > 0) {
    const byId = new Map<
      string,
      { id: string; originalName: string; mimeType: string }
    >();
    for (const a of attachmentLists) {
      if (
        a &&
        typeof a === "object" &&
        typeof (a as { id?: string }).id === "string"
      )
        byId.set(
          (a as { id: string }).id,
          a as { id: string; originalName: string; mimeType: string },
        );
    }
    merged.attachments = Array.from(byId.values());
  }
  return merged;
}

function toSafeBullmqId(raw: string): string {
  // BullMQ custom IDs cannot contain ":".
  return raw.replaceAll(":", "__");
}

export function createQueueDispatcher(
  queue: EventQueueAdapter,
  options?: { dedupSet?: Set<string>; debounce?: DebounceOptions },
): QueueDispatcher {
  const debounce = options?.debounce;
  if (!debounce) {
    return {
      async dispatch(raw, opts) {
        return enqueueRaw(queue, raw, {
          correlationId: opts?.correlationId,
          dedupSet: options?.dedupSet,
        });
      },
    };
  }

  const connection = connectionFromUrl(debounce.connection);
  const debounceQueue = new Queue<DebouncedQueueJob, void, string>(
    DEBOUNCE_QUEUE_NAME,
    {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    },
  );
  const debounceWorker = new Worker<DebouncedQueueJob, void, string>(
    DEBOUNCE_QUEUE_NAME,
    async (job) => {
      const payload = mergeMessagePayloads(
        job.data.raw.payload,
        job.data.payloads,
      );
      await enqueueRaw(
        queue,
        {
          ...job.data.raw,
          payload,
        },
        { dedupSet: options?.dedupSet },
      );
    },
    { connection, concurrency: 1 },
  );

  return {
    async dispatch(raw, opts) {
      if (opts?.correlationId) {
        // Preserve correlation semantics (web/api wait-for-result uses eventId).
        return enqueueRaw(queue, raw, {
          correlationId: opts.correlationId,
          dedupSet: options?.dedupSet,
        });
      }
      const windowMs = debounce.windowsMs[raw.source] ?? 0;
      if (windowMs <= 0) {
        return enqueueRaw(queue, raw, {
          correlationId: opts?.correlationId,
          dedupSet: options?.dedupSet,
        });
      }
      const key = computeDebounceKey(raw);
      if (!key) {
        return enqueueRaw(queue, raw, {
          correlationId: opts?.correlationId,
          dedupSet: options?.dedupSet,
        });
      }
      const jobId = toSafeBullmqId(`debounce:${key}`);
      const existing = await debounceQueue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "delayed") {
          const existingPayloads = existing.data.payloads ?? [];
          const payloads = [...existingPayloads, raw.payload];
          await existing.updateData({ raw, payloads });
          await existing.changeDelay(windowMs);
          debug(
            "Debounced message source=%s key=%s count=%d",
            raw.source,
            key,
            payloads.length,
          );
          return jobId;
        }
        // Existing job already left delayed state (waiting/active/completed).
        // Start a fresh debounce cycle from the current message.
        await existing.remove().catch(() => {});
        await debounceQueue.add(
          "debounced-message",
          { raw, payloads: [raw.payload] },
          {
            jobId,
            delay: windowMs,
          },
        );
        debug(
          "Debounced message source=%s key=%s count=%d",
          raw.source,
          key,
          1,
        );
        return jobId;
      } else {
        await debounceQueue.add(
          "debounced-message",
          { raw, payloads: [raw.payload] },
          {
            jobId,
            delay: windowMs,
          },
        );
        debug(
          "Debounced message source=%s key=%s count=%d",
          raw.source,
          key,
          1,
        );
        return jobId;
      }
    },
    async close() {
      await debounceWorker.close();
      await debounceQueue.close();
    },
  };
}
