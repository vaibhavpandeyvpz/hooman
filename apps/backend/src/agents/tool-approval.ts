/**
 * Tool approval: "Allow everything" setting. When enabled, no approval prompts;
 * all tool calls run without asking. Stored in Redis so API and event-queue worker share state.
 * Requires initRedis before initToolApproval.
 */
import { getRedis } from "../data/redis.js";

const REDIS_KEY = "hooman:tool_approval:allow_everything";
const POLL_MS = 1000;

let allowEverything = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshFromRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const v = await redis.get(REDIS_KEY);
    allowEverything = v === "1";
  } catch {
    // keep current cached value on error
  }
}

/**
 * Initialize tool-approval state with Redis. Call once at startup (API and event-queue worker).
 */
export function initToolApproval(redisUrl: string): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  allowEverything = false;

  const url = redisUrl?.trim() ?? "";
  if (!url) return;

  const redis = getRedis();
  if (!redis) return;
  void refreshFromRedis();
  pollTimer = setInterval(() => void refreshFromRedis(), POLL_MS);
}

export async function closeToolApproval(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getToolApprovalAllowEverything(): boolean {
  return allowEverything;
}

export function setToolApprovalAllowEverything(value: boolean): void {
  allowEverything = value;
  const redis = getRedis();
  if (redis) {
    redis.set(REDIS_KEY, value ? "1" : "0").catch(() => {});
  }
}
