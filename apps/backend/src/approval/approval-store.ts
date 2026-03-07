/**
 * Pending tool-approval store. Keyed by userId (and channel) so the same user on different
 * channels has separate pending approvals. Backed by Redis with TTL.
 */
import { getRedis } from "../data/redis.js";
import type { ChannelMeta } from "../types.js";

const REDIS_KEY_PREFIX = "hooman:approval:pending:";
const TTL_SECONDS = 15 * 60; // 15 minutes

export interface PendingApproval {
  approvalId: string;
  userId: string;
  channelMeta?: ChannelMeta;
  eventId: string;
  toolName: string;
  toolArgs: unknown;
  /** Serialized message list at pause (JSON). */
  threadSnapshotJson: string;
  /** Approval prompt text we sent (for LLM reply parsing). */
  approvalMessage?: string;
  /** SDK tool call id for building tool result message on resume. */
  toolCallId?: string;
  /** Tool id for allow-every-time store. */
  toolId?: string;
  createdAt: string;
  expiresAt: string;
}

function approvalKey(userId: string, channelKey?: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (channelKey) {
    const safeChannel = channelKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${REDIS_KEY_PREFIX}${safe}:${safeChannel}`;
  }
  return `${REDIS_KEY_PREFIX}${safe}`;
}

/** Channel key for same user on different channels (e.g. slack:channelId, whatsapp:chatId). */
export function channelKeyFromMeta(
  meta: ChannelMeta | undefined,
): string | undefined {
  if (!meta) return undefined;
  if (meta.channel === "slack")
    return `slack:${(meta as { channelId: string }).channelId}`;
  if (meta.channel === "whatsapp")
    return `whatsapp:${(meta as { chatId: string }).chatId}`;
  return undefined;
}

export function setPending(
  userId: string,
  data: Omit<PendingApproval, "approvalId" | "createdAt" | "expiresAt">,
  channelKey?: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return Promise.resolve();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_SECONDS * 1000);
  const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const entry: PendingApproval = {
    ...data,
    approvalId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const key = approvalKey(userId, channelKey);
  const value = JSON.stringify(entry);
  return redis.set(key, value, "EX", TTL_SECONDS).then(() => {});
}

export function getPending(
  userId: string,
  channelKey?: string,
): Promise<PendingApproval | null> {
  const redis = getRedis();
  if (!redis) return Promise.resolve(null);
  const key = approvalKey(userId, channelKey);
  return redis.get(key).then((raw) => {
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as PendingApproval;
      if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) {
        void redis.del(key);
        return null;
      }
      return entry;
    } catch {
      void redis.del(key);
      return null;
    }
  });
}

/** Get and delete pending in one go. */
export function consumePending(
  userId: string,
  channelKey?: string,
): Promise<PendingApproval | null> {
  const redis = getRedis();
  if (!redis) return Promise.resolve(null);
  const key = approvalKey(userId, channelKey);
  return redis.get(key).then((raw) => {
    if (!raw) return null;
    void redis.del(key);
    try {
      const entry = JSON.parse(raw) as PendingApproval;
      if (entry.expiresAt && new Date(entry.expiresAt) <= new Date())
        return null;
      return entry;
    } catch {
      return null;
    }
  });
}

export function clearPending(
  userId: string,
  channelKey?: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return Promise.resolve();
  const key = approvalKey(userId, channelKey);
  return redis.del(key).then(() => {});
}
