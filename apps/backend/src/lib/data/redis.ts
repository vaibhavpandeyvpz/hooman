/**
 * Shared Redis client. Call initRedis(redisUrl) once at process startup (API and workers);
 * then use getRedis() where a Redis connection is needed. Avoids creating multiple clients.
 */
import { Redis } from "ioredis";

let client: Redis | null = null;
let currentUrl = "";

const DEFAULT_OPTIONS = { maxRetriesPerRequest: 3 };

/**
 * Initialize the shared Redis client. Idempotent: same URL is a no-op; different URL replaces the client.
 * Call before initKillSwitch, createEventQueue, or initReloadWatch.
 */
export function initRedis(redisUrl: string): void {
  const url = redisUrl?.trim() ?? "";
  if (url === currentUrl && client) return;
  if (client) {
    client.disconnect();
    client = null;
  }
  currentUrl = url;
  if (!url) return;
  client = new Redis(url, { ...DEFAULT_OPTIONS });
  client.on("error", () => {
    // avoid crashing; callers handle errors
  });
}

/**
 * Return the shared Redis client, or null if not initialized or URL was empty.
 */
export function getRedis(): Redis | null {
  return client;
}

/**
 * Close the shared client. Call on process shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
  currentUrl = "";
}
