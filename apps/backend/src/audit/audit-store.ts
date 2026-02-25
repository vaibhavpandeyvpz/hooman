import { randomUUID } from "crypto";
import { getPrisma } from "../data/db.js";
import type { AuditLogEntry } from "../types.js";

export interface AuditStore {
  append(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void>;
  getAuditLog(): Promise<AuditLogEntry[]>;
}

export function createAuditStore(): AuditStore {
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
    },
    async getAuditLog() {
      const prisma = getPrisma();
      const rows = (await prisma.auditEntry.findMany({
        orderBy: { timestamp: "desc" },
      })) as Array<{
        id: string;
        timestamp: string;
        type: string;
        payload: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        type: r.type as AuditLogEntry["type"],
        payload: JSON.parse(r.payload) as Record<string, unknown>,
      }));
    },
  };
}
