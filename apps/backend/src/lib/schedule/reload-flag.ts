/**
 * Redis-backed reload flag so the API can signal cron and channel workers to reload
 * (schedules from DB, or channel config). Uses shared client from data/redis; call initRedis(redisUrl) first.
 */
import { initRedis, getRedis } from "../data/redis.js";

const REDIS_KEY = "hooman:workers:reload";
const POLL_MS = 2000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Set the reload flag. Call from API after schedule add/cancel or channels update.
 * Uses shared Redis client if initRedis was called; otherwise no-op.
 */
export async function setReloadFlag(redisUrl: string): Promise<void> {
  const url = redisUrl?.trim();
  if (!url) return;
  initRedis(redisUrl);
  const redis = getRedis();
  if (!redis) return;
  await redis.set(REDIS_KEY, "1");
}

/**
 * Start watching the reload flag and invoke onReload when it is set, then clear it.
 * Call from cron worker. Requires initRedis(redisUrl) to have been called first.
 */
export function initReloadWatch(
  redisUrl: string,
  onReload: () => void | Promise<void>,
): void {
  const url = redisUrl.trim();
  if (!url) return;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  initRedis(redisUrl);
  const redis = getRedis();
  if (!redis) return;

  pollTimer = setInterval(async () => {
    try {
      const v = await redis.get(REDIS_KEY);
      if (v === "1") {
        await redis.del(REDIS_KEY);
        await onReload();
      }
    } catch {
      // keep polling on error
    }
  }, POLL_MS);
}

/**
 * Stop watching. Does not close the Redis client; call closeRedis() on shutdown.
 */
export async function closeReloadWatch(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
