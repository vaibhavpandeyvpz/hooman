import type { AuditLogEntry } from "../types.js";
import type { AuditStore } from "./audit-store.js";

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
 * Audit log and response emission. Entries are persisted via the store (Prisma)
 * and shared across API and workers.
 */
export class AuditLog {
  private onResponse: ResponseHandler[] = [];
  private store: AuditStore;

  constructor(store: AuditStore) {
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
    this.appendAuditEntry({
      type: "decision",
      payload: payload as unknown as Record<string, unknown>,
    });
    this.onResponse.forEach((h) => h(payload));
  }

  async getAuditLog(): Promise<AuditLogEntry[]> {
    return this.store.getAuditLog();
  }

  async appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void> {
    await this.store.append(entry);
  }
}
