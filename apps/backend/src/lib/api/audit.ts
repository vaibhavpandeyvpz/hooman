import type { AuditLogEntry } from "../core/types.js";
import type { AuditStore } from "../data/audit-store.js";
import { randomUUID } from "crypto";

export type ResponsePayload =
  | { type: "response"; text: string; eventId: string; userInput?: string }
  | {
      type: "decision";
      decision: {
        type: string;
        eventId?: string;
        reasoning?: string;
        payload?: unknown;
      };
      eventId: string;
      userInput?: string;
    }
  | {
      type: "capability_request";
      integration: string;
      capability: string;
      reason: string;
      eventId: string;
      userInput?: string;
    };

export type ResponseHandler = (payload: ResponsePayload) => void;

/**
 * Audit log and response emission. When a store is provided (Prisma), entries
 * are persisted and shared across API and workers. Otherwise in-memory only.
 */
export class AuditLog {
  private onResponse: ResponseHandler[] = [];
  private entries: AuditLogEntry[] = [];
  private store?: AuditStore;

  constructor(store?: AuditStore) {
    this.store = store;
  }

  onResponseReceived(handler: ResponseHandler): () => void {
    this.onResponse.push(handler);
    return () => {
      this.onResponse = this.onResponse.filter((h) => h !== handler);
    };
  }

  /** Call after an agent run to push response to SSE / responseStore. */
  emitResponse(payload: ResponsePayload): void {
    if (this.store) {
      void this.appendAuditEntry({
        type: "decision",
        payload: payload as unknown as Record<string, unknown>,
      });
    } else {
      this.entries.push({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: "decision",
        payload: payload as unknown as Record<string, unknown>,
      });
    }
    this.onResponse.forEach((h) => h(payload));
  }

  async getAuditLog(): Promise<AuditLogEntry[]> {
    if (this.store) return this.store.getAuditLog();
    return [...this.entries];
  }

  async appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void> {
    if (this.store) {
      await this.store.append(entry);
      return;
    }
    this.entries.push({
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    });
  }
}
