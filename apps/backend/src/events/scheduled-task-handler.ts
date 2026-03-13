/**
 * Scheduled task event handler. Runs the agent with task intent and context.
 * Extracted from event-handlers.ts for clarity.
 */
import createDebug from "debug";
import type { NormalizedEvent } from "../types.js";
import type { AuditLog } from "../audit/audit.js";
import type { RunChatOptions } from "../agents/hooman-runner.js";
import { getConfig } from "../config.js";
import {
  DEFAULT_CHAT_TIMEOUT_MS,
  type RunAgentFn,
} from "./chat-handler-shared.js";

const debug = createDebug("hooman:scheduled-task-handler");

export interface ScheduledTaskHandlerDeps {
  auditLog: AuditLog;
  runAgent: RunAgentFn;
}

function toTextContext(context: Record<string, unknown>): string {
  const entries = Object.entries(context).map(([k, v]) => `${k}=${String(v)}`);
  return entries.length ? entries.join(", ") : "(none)";
}

function buildExecutionPrompt(payload: {
  intent: string;
  context: Record<string, unknown>;
}): string {
  const contextText = toTextContext(payload.context);
  const intent = payload.intent.trim() || "(missing)";
  return [
    "You are executing an already-triggered scheduled task right now.",
    "This is not a request to schedule something new.",
    "",
    `Task context: ${contextText}`,
    "",
    `Task intent: ${intent}`,
    "",
    "Required behavior:",
    "- Perform the task now.",
    "- Do not ask follow-up or scheduling questions.",
  ].join("\n");
}

export function createScheduledTaskHandler(
  deps: ScheduledTaskHandlerDeps,
): (event: NormalizedEvent) => Promise<void> {
  const { auditLog, runAgent } = deps;

  return async (event: NormalizedEvent) => {
    if (event.payload.kind !== "scheduled_task") return;

    const payload = event.payload;
    const text = buildExecutionPrompt({
      intent: payload.intent,
      context: payload.context,
    });
    const runOptions: RunChatOptions = {
      source: "scheduler",
      sessionId: payload.context.userId
        ? String(payload.context.userId)
        : undefined,
    };
    const chatTimeoutMs =
      getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;

    try {
      const { output } = await runAgent([], text, runOptions, chatTimeoutMs);
      const assistantText =
        output?.trim() ||
        "Scheduled task completed (no clear response from agent).";
      await auditLog.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          intent: payload.intent,
          context: payload.context,
          ...(payload.execute_at ? { execute_at: payload.execute_at } : {}),
          ...(payload.cron ? { cron: payload.cron } : {}),
        },
      });
      auditLog.emitResponse({
        type: "response",
        text: assistantText,
        eventId: event.id,
        userInput: `Scheduled task fired: ${payload.intent}`,
      });
    } catch (err) {
      debug("scheduled task handler error: %o", err);
      const msg = (err as Error).message;
      await auditLog.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          intent: payload.intent,
          context: payload.context,
          ...(payload.execute_at ? { execute_at: payload.execute_at } : {}),
          ...(payload.cron ? { cron: payload.cron } : {}),
          error: msg,
        },
      });
      auditLog.emitResponse({
        type: "response",
        text: `Scheduled task failed: ${msg}. Check API logs.`,
        eventId: event.id,
        userInput: text,
      });
    }
  };
}
