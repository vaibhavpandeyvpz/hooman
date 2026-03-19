/**
 * Shared event handlers for chat, turn_completed, and scheduled tasks.
 * Used by the event-queue worker (BullMQ) — the only place that runs agents.
 */
import type { EventRouter } from "./event-router.js";
import type { HoomanRunner } from "../agents/hooman-runner.js";
import type { ResponseDeliveryPayload } from "../types.js";
import type { ContextStore } from "../chats/context.js";
import type { AuditLog } from "../audit/audit.js";
import type { AttachmentService } from "../attachments/attachment-service.js";
import type { ToolSettingsStore } from "../capabilities/mcp/tool-settings-store.js";
import { createRunAgent } from "./chat-handler-shared.js";
import { createChatHandler } from "./chat-handler.js";
import { createScheduledTaskHandler } from "./scheduled-task-handler.js";

export interface EventHandlerDeps {
  eventRouter: EventRouter;
  context: ContextStore;
  auditLog: AuditLog;
  /** Publishes response to Redis; API/Slack/WhatsApp subscribers deliver accordingly. */
  publishResponse: (payload: ResponseDeliveryPayload) => void;
  /** Returns the current agent session (generate). */
  getRunner: () => Promise<HoomanRunner>;
  attachmentService: AttachmentService;
  /** Per-tool settings (disabled, allow-every-time). Used when user replies "always" to approval prompt. */
  toolSettingsStore?: ToolSettingsStore;
  /** Called when allow-every-time is set; invalidates runner cache so next run picks up new settings. */
  invalidateRunnerCache?: () => void;
}

export function registerEventHandlers(deps: EventHandlerDeps): void {
  const {
    eventRouter,
    context,
    auditLog,
    publishResponse,
    getRunner,
    attachmentService,
    toolSettingsStore,
    invalidateRunnerCache,
  } = deps;

  const runAgent = createRunAgent(getRunner);

  eventRouter.register(
    createChatHandler({
      context,
      auditLog,
      publishResponse,
      getRunner,
      runAgent,
      attachmentService,
      toolSettingsStore,
      invalidateRunnerCache,
    }),
  );

  eventRouter.register(
    createScheduledTaskHandler({
      auditLog,
      runAgent,
    }),
  );
}

// Re-export for consumers that import ChatTimeoutError or DEFAULT_CHAT_TIMEOUT_MS
export {
  ChatTimeoutError,
  DEFAULT_CHAT_TIMEOUT_MS,
} from "./chat-handler-shared.js";
