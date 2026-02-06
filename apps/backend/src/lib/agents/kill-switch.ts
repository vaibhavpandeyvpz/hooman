/**
 * Kill switch: when enabled, event processing is paused (no events dequeued or processed).
 * State is stored in Redis so API and event-queue worker share the same value. Redis is required.
 * Uses the shared client from lib/data/redis; call initRedis(redisUrl) before initKillSwitch.
 */
import { initRedis, getRedis } from "../data/redis.js";

const REDIS_KEY = "hooman:kill_switch";
const POLL_MS = 1000;

let enabled = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshFromRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const v = await redis.get(REDIS_KEY);
    enabled = v === "1";
  } catch {
    // keep current cached value on error
  }
}

/**
 * Initialize kill switch with Redis. Call once at startup (API and event-queue worker).
 * Requires redisUrl; uses shared client from data/redis.
 */
export function initKillSwitch(redisUrl: string): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  enabled = false;

  const url = redisUrl.trim();
  if (!url) throw new Error("initKillSwitch requires a non-empty Redis URL");

  initRedis(redisUrl);
  const redis = getRedis();
  if (!redis)
    throw new Error("initKillSwitch: initRedis did not create a client");
  void refreshFromRedis();
  pollTimer = setInterval(() => void refreshFromRedis(), POLL_MS);
}

/**
 * Close kill switch (stop polling). Does not close the Redis client; call closeRedis() on shutdown.
 */
export async function closeKillSwitch(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getKillSwitchEnabled(): boolean {
  return enabled;
}

export function setKillSwitchEnabled(value: boolean): void {
  enabled = value;
  const redis = getRedis();
  if (redis) {
    redis.set(REDIS_KEY, value ? "1" : "0").catch(() => {
      // best-effort; cache already updated
    });
  }
}
