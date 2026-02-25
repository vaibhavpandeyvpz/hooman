import createDebug from "debug";
import type { NormalizedEvent } from "../types.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";

const debug = createDebug("hooman:event-router");

export type EventHandler = (event: NormalizedEvent) => void | Promise<void>;

/**
 * Routes normalized events to registered handlers. Used by the event-queue worker
 * to dispatch BullMQ jobs to the appropriate handler functions.
 */
export class EventRouter {
  private handlers: EventHandler[] = [];

  register(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /**
   * Run all registered handlers for one event. Called by the queue worker.
   */
  async runHandlersForEvent(event: NormalizedEvent): Promise<void> {
    if (getKillSwitchEnabled()) return;
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (err) {
        debug("handler error: %o", err);
      }
    }
  }
}
