/**
 * Shared event handlers for chat, turn_completed, and scheduled tasks.
 * Used by the API (in-memory mode) and by the workers process (BullMQ) so the worker is the only place that runs agents when Redis is used.
 */
import createDebug from "debug";
import type { EventRouter } from "./event-router.js";
import type { ContextStore } from "../agents/context.js";
import type { ColleagueEngine } from "../agents/colleagues.js";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import type { AuditLog } from "../api/audit.js";
import { runChat } from "../agents/agents-runner.js";
import { createHoomanAgentWithMcp } from "../agents/agents-mcp.js";
import type { RawDispatchInput } from "../core/types.js";

const debug = createDebug("hooman:event-handlers");

const CHAT_THREAD_LIMIT = 30;

export interface EventHandlerDeps {
  eventRouter: EventRouter;
  context: ContextStore;
  colleagueEngine: ColleagueEngine;
  mcpConnectionsStore: MCPConnectionsStore;
  getConfig: () => { OPENAI_API_KEY: string; OPENAI_MODEL: string };
  auditLog: AuditLog;
  /** When set, called for api-source chat to deliver result (API: resolve pending; worker: POST to API). */
  deliverApiResult?: (
    eventId: string,
    message: { role: "assistant"; text: string; lastAgentName?: string },
  ) => void | Promise<void>;
}

export function registerEventHandlers(deps: EventHandlerDeps): void {
  const {
    eventRouter,
    context,
    colleagueEngine,
    mcpConnectionsStore,
    getConfig,
    auditLog,
    deliverApiResult,
  } = deps;

  // turn_completed: persist turn to chat history only for UI (api source)
  eventRouter.register(async (event) => {
    if (
      event.type === "chat.turn_completed" &&
      event.payload.kind === "internal" &&
      event.source === "api"
    ) {
      const data = event.payload.data as {
        userId: string;
        userText: string;
        assistantText: string;
        userAttachmentIds?: string[];
      };
      const { userId, userText, assistantText, userAttachmentIds } = data;
      await context.addTurn(userId, userText, assistantText, userAttachmentIds);
    }
  });

  // Chat handler: message.sent → run agents; for api source call deliverApiResult when set
  eventRouter.register(async (event) => {
    if (event.payload.kind !== "message") return;
    const { text, userId, attachments, attachment_ids } = event.payload;
    const sourceLabel = event.source === "api" ? "ui" : event.source;
    await context.addToMemory(
      [{ role: "user", content: `[${sourceLabel}] ${text}` }],
      { userId, metadata: { source: event.source } },
    );
    const config = getConfig();
    let assistantText = "";
    try {
      const recent = await context.getRecentMessages(userId, CHAT_THREAD_LIMIT);
      const thread = recent.map((m) => ({ role: m.role, content: m.text }));
      const memories = await context.search(text, { userId, limit: 5 });
      const memoryContext =
        memories.length > 0
          ? memories.map((m) => `- ${m.memory}`).join("\n")
          : "";
      const colleagues = colleagueEngine.getAll();
      const connections = await mcpConnectionsStore.getAll();
      const { agent, closeMcp } = await createHoomanAgentWithMcp(
        colleagues,
        connections,
        {
          apiKey: config.OPENAI_API_KEY || undefined,
          model: config.OPENAI_MODEL,
        },
      );
      try {
        const { finalOutput, lastAgentName, newItems } = await runChat(
          agent,
          thread,
          text,
          {
            memoryContext,
            apiKey: config.OPENAI_API_KEY || undefined,
            model: config.OPENAI_MODEL || undefined,
            attachments,
          },
        );
        assistantText =
          finalOutput?.trim() ||
          "I didn't get a clear response. Try rephrasing or check your API key and model settings.";
        const handoffs = (newItems ?? []).filter(
          (i) =>
            i.type === "handoff_call_item" || i.type === "handoff_output_item",
        );
        auditLog.appendAuditEntry({
          type: "agent_run",
          payload: {
            userInput: text,
            response: assistantText,
            lastAgentName: lastAgentName ?? "Hooman",
            handoffs: handoffs.map((h) => ({
              type: h.type,
              from: h.agent?.name ?? h.sourceAgent?.name,
              to: h.targetAgent?.name,
            })),
          },
        });
        auditLog.emitResponse({
          type: "response",
          text: assistantText,
          eventId: event.id,
          userInput: text,
        });
        await context.addToMemory(
          [{ role: "assistant", content: assistantText }],
          { userId, metadata: { source: event.source } },
        );
        await eventRouter.dispatch({
          source: "api",
          type: "chat.turn_completed",
          payload: {
            userId,
            userText: text,
            assistantText,
            ...(attachment_ids?.length
              ? { userAttachmentIds: attachment_ids }
              : {}),
          },
        } as RawDispatchInput);
        if (deliverApiResult && event.source === "api") {
          await deliverApiResult(event.id, {
            role: "assistant",
            text: assistantText,
            lastAgentName: lastAgentName ?? undefined,
          });
        }
      } finally {
        await closeMcp();
      }
    } catch (err) {
      const msg = (err as Error).message;
      assistantText = !config.OPENAI_API_KEY?.trim()
        ? "[Hooman] No LLM API key configured. Set it in Settings to enable chat."
        : `Something went wrong: ${msg}. Check API logs.`;
      await context.addToMemory(
        [{ role: "assistant", content: assistantText }],
        { userId, metadata: { source: event.source } },
      );
      await eventRouter.dispatch({
        source: "api",
        type: "chat.turn_completed",
        payload: {
          userId,
          userText: text,
          assistantText,
          ...(attachment_ids?.length
            ? { userAttachmentIds: attachment_ids }
            : {}),
        },
      } as RawDispatchInput);
      if (deliverApiResult && event.source === "api") {
        await deliverApiResult(event.id, {
          role: "assistant",
          text: assistantText,
        });
      }
    }
  });

  // Scheduled task handler
  eventRouter.register(async (event) => {
    if (event.payload.kind !== "scheduled_task") return;
    const payload = event.payload;
    const contextStr =
      Object.keys(payload.context).length === 0
        ? "(none)"
        : Object.entries(payload.context)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(", ");
    const text = `Scheduled task: ${payload.intent}. Context: ${contextStr}.`;
    await context.addToMemory(
      [{ role: "user", content: `[scheduler] ${text}` }],
      { userId: "default", metadata: { source: "scheduler" } },
    );
    const apiConfig = getConfig();
    try {
      const memories = await context.search(text, {
        userId: "default",
        limit: 5,
      });
      const memoryContext =
        memories.length > 0
          ? memories.map((m) => `- ${m.memory}`).join("\n")
          : "";
      const colleagues = colleagueEngine.getAll();
      const connections = await mcpConnectionsStore.getAll();
      const { agent, closeMcp } = await createHoomanAgentWithMcp(
        colleagues,
        connections,
        {
          apiKey: apiConfig.OPENAI_API_KEY || undefined,
          model: apiConfig.OPENAI_MODEL,
        },
      );
      try {
        const { finalOutput, lastAgentName, newItems } = await runChat(
          agent,
          [],
          text,
          {
            memoryContext,
            apiKey: apiConfig.OPENAI_API_KEY || undefined,
            model: apiConfig.OPENAI_MODEL || undefined,
          },
        );
        const assistantText =
          finalOutput?.trim() ||
          "Scheduled task completed (no clear response from agent).";
        const handoffs = (newItems ?? []).filter(
          (i) =>
            i.type === "handoff_call_item" || i.type === "handoff_output_item",
        );
        auditLog.appendAuditEntry({
          type: "scheduled_task",
          payload: {
            execute_at: payload.execute_at,
            intent: payload.intent,
            context: payload.context,
          },
        });
        auditLog.appendAuditEntry({
          type: "agent_run",
          payload: {
            userInput: text,
            response: assistantText,
            lastAgentName: lastAgentName ?? "Hooman",
            handoffs: handoffs.map((h) => ({
              type: h.type,
              from: h.agent?.name ?? h.sourceAgent?.name,
              to: h.targetAgent?.name,
            })),
          },
        });
        auditLog.emitResponse({
          type: "response",
          text: assistantText,
          eventId: event.id,
          userInput: text,
        });
        await context.addToMemory(
          [{ role: "assistant", content: assistantText }],
          { userId: "default", metadata: { source: "scheduler" } },
        );
      } finally {
        await closeMcp();
      }
    } catch (err) {
      debug("scheduled task handler error: %o", err);
      const msg = (err as Error).message;
      await context.addToMemory(
        [{ role: "assistant", content: `Scheduled task failed: ${msg}` }],
        { userId: "default", metadata: { source: "scheduler", error: true } },
      );
      auditLog.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          execute_at: payload.execute_at,
          intent: payload.intent,
          context: payload.context,
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
  });
}
