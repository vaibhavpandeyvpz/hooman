/**
 * Event-queue worker: runs the BullMQ worker that processes events (chat, scheduled tasks).
 * Agents run here; human-friendly trace export is configured in this process.
 * Posts chat results to API via POST /api/internal/chat-result.
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only event-queue).
 */
import createDebug from "debug";
import { mkdirSync } from "fs";
import {
  addTraceProcessor,
  BatchTraceProcessor,
  startTraceExportLoop,
} from "@openai/agents";
import { HumanFriendlyConsoleExporter } from "../lib/agents/tracing.js";
import { loadPersisted, getConfig } from "../lib/core/config.js";
import { createEventQueue } from "../lib/events/event-queue.js";
import { EventRouter } from "../lib/events/event-router.js";
import { registerEventHandlers } from "../lib/events/event-handlers.js";
import { createMemoryService } from "../lib/data/memory.js";
import { AuditLog } from "../lib/api/audit.js";
import { ColleagueEngine } from "../lib/agents/colleagues.js";
import { createContext } from "../lib/agents/context.js";
import { initColleagueStore } from "../lib/data/colleagues-store.js";
import { initScheduleStore } from "../lib/data/schedule-store.js";
import { initMCPConnectionsStore } from "../lib/data/mcp-connections-store.js";
import { initDb } from "../lib/data/db.js";
import { initChatHistory } from "../lib/data/chat-history.js";
import {
  createAuditStore,
  AUDIT_ENTRY_ADDED_CHANNEL,
} from "../lib/data/audit-store.js";
import { publish } from "../lib/data/pubsub.js";
import { initRedis, closeRedis } from "../lib/data/redis.js";
import { initKillSwitch, closeKillSwitch } from "../lib/agents/kill-switch.js";
import { env } from "../env.js";
import { WORKSPACE_ROOT, WORKSPACE_MCPCWD } from "../lib/core/workspace.js";

const debug = createDebug("hooman:workers:event-queue");

async function main() {
  if (!env.REDIS_URL) {
    debug("REDIS_URL is required for the event-queue worker. Set it in .env.");
    process.exit(1);
  }

  await loadPersisted();
  mkdirSync(WORKSPACE_ROOT, { recursive: true });
  mkdirSync(WORKSPACE_MCPCWD, { recursive: true });
  await initDb();
  initRedis(env.REDIS_URL);
  initKillSwitch(env.REDIS_URL);

  addTraceProcessor(
    new BatchTraceProcessor(new HumanFriendlyConsoleExporter()),
  );
  startTraceExportLoop();

  const config = getConfig();
  const memory = await createMemoryService({
    openaiApiKey: config.OPENAI_API_KEY,
    embeddingModel: config.OPENAI_EMBEDDING_MODEL,
    llmModel: config.OPENAI_MODEL,
  });
  const chatHistory = await initChatHistory();
  const context = createContext(memory, chatHistory);
  const colleagueStore = await initColleagueStore();
  const colleagueEngine = new ColleagueEngine(colleagueStore);
  await colleagueEngine.load();
  const mcpConnectionsStore = await initMCPConnectionsStore();
  await initScheduleStore();
  const auditStore = createAuditStore({
    onAppend: () => publish(AUDIT_ENTRY_ADDED_CHANNEL, "1"),
  });
  const auditLog = new AuditLog(auditStore);

  const eventRouter = new EventRouter();
  const apiBase = env.API_BASE_URL.replace(/\/$/, "");
  const chatResultUrl = `${apiBase}/api/internal/chat-result`;
  const internalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(env.INTERNAL_SECRET
      ? { "X-Internal-Secret": env.INTERNAL_SECRET }
      : {}),
  };
  registerEventHandlers({
    eventRouter,
    context,
    colleagueEngine,
    mcpConnectionsStore,
    getConfig,
    auditLog,
    deliverApiResult: async (eventId, message) => {
      const res = await fetch(chatResultUrl, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ eventId, message }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`chat-result ${res.status}: ${text}`);
      }
    },
  });

  const eventQueue = createEventQueue({ connection: env.REDIS_URL });
  eventQueue.startWorker(async (event) => {
    debug(
      "Event received: type=%s source=%s id=%s",
      event.type,
      event.source,
      event.id,
    );
    await eventRouter.runHandlersForEvent(event);
  });
  debug(
    "Event-queue worker started (agents run here); chat results to %s",
    chatResultUrl,
  );

  const shutdown = async () => {
    debug("Shutting down event-queue worker…");
    await closeKillSwitch();
    await eventQueue.close();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  debug("Event-queue worker failed: %o", err);
  process.exit(1);
});
