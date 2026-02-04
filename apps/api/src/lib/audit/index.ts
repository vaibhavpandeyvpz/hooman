import type { AuditLogEntry } from "../types/index.js";
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
 * In-memory audit log and response emission. Handlers (chat, scheduled tasks)
 * call appendAuditEntry and emitResponse after each agent run.
 */
export class AuditLog {
  private onResponse: ResponseHandler[] = [];
  private entries: AuditLogEntry[] = [];

  onResponseReceived(handler: ResponseHandler): () => void {
    this.onResponse.push(handler);
    return () => {
      this.onResponse = this.onResponse.filter((h) => h !== handler);
    };
  }

  /** Call after an agent run to push response to SSE / responseStore. */
  emitResponse(payload: ResponsePayload): void {
    this.entries.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "decision",
      payload: payload as unknown as Record<string, unknown>,
    });
    this.onResponse.forEach((h) => h(payload));
  }

  getAuditLog(): AuditLogEntry[] {
    return [...this.entries];
  }

  appendAuditEntry(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
    this.entries.push({
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    });
  }
}
