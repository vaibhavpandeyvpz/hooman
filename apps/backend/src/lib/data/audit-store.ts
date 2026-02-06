import { randomUUID } from "crypto";
import { getPrisma } from "./db.js";
import type { AuditLogEntry } from "../core/types.js";

/** Redis channel to notify when a new audit entry is added (API subscribes and emits on Socket.IO). */
export const AUDIT_ENTRY_ADDED_CHANNEL = "audit:entry-added";

export interface AuditStoreOptions {
  /** Called after an entry is persisted. Use to publish to Redis so the API can emit on Socket.IO. */
  onAppend?: () => void;
}

export interface AuditStore {
  append(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void>;
  getAuditLog(): Promise<AuditLogEntry[]>;
}

export function createAuditStore(options?: AuditStoreOptions): AuditStore {
  const { onAppend } = options ?? {};
  return {
    async append(entry) {
      const prisma = getPrisma();
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      await prisma.auditEntry.create({
        data: {
          id,
          timestamp,
          type: entry.type,
          payload: JSON.stringify(entry.payload),
        },
      });
      onAppend?.();
    },
    async getAuditLog() {
      const prisma = getPrisma();
      const rows = await prisma.auditEntry.findMany({
        orderBy: { timestamp: "desc" },
      });
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        type: r.type as AuditLogEntry["type"],
        payload: JSON.parse(r.payload) as Record<string, unknown>,
      }));
    },
  };
}
