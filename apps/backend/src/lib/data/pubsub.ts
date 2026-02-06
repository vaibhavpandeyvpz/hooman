/**
 * Redis-backed pub/sub helpers. Use for cross-process notifications (e.g. API and workers).
 * Publish uses the shared Redis client; subscribe uses a duplicate connection (subscriber mode).
 * Call initRedis() before using.
 */
import { getRedis } from "./redis.js";

/**
 * Publish a message to a channel. No-op if Redis is not initialized.
 */
export function publish(channel: string, message: string): void {
  const redis = getRedis();
  if (redis) void redis.publish(channel, message);
}

export interface Subscriber {
  /** Subscribe to a channel. onMessage(message) is called for each message. */
  subscribe(channel: string, onMessage: (message: string) => void): void;
  /** Unsubscribe from a channel. */
  unsubscribe(channel: string): void;
  /** Close the subscriber connection. */
  close(): Promise<void>;
}

/**
 * Create a subscriber that uses a dedicated Redis connection (duplicate of the shared client).
 * Use for subscribe only; keep using publish() for sending. Returns null if Redis is not initialized.
 */
export function createSubscriber(): Subscriber | null {
  const redis = getRedis();
  if (!redis) return null;

  const sub = redis.duplicate();
  const channels = new Map<string, (message: string) => void>();
  const pending = new Set<string>();

  sub.on("message", (channel: string, message: string) => {
    const cb = channels.get(channel);
    if (cb) cb(message);
  });

  function doSubscribe(channel: string) {
    if (!channels.has(channel)) return;
    sub.subscribe(channel, (err) => {
      if (err) sub.emit("error", err);
    });
  }

  sub.on("ready", () => {
    pending.forEach((ch) => doSubscribe(ch));
    pending.clear();
  });

  return {
    subscribe(channel, onMessage) {
      if (channels.has(channel)) return;
      channels.set(channel, onMessage);
      if (sub.status === "ready") {
        doSubscribe(channel);
      } else {
        pending.add(channel);
      }
    },
    unsubscribe(channel) {
      channels.delete(channel);
      sub.unsubscribe(channel);
    },
    async close() {
      await sub.quit();
    },
  };
}
