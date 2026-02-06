import createDebug from "debug";
import http from "http";
import express from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

const debug = createDebug("hooman:api");
import { EventRouter } from "./lib/events/event-router.js";
import { createMemoryService } from "./lib/data/memory.js";
import { AuditLog } from "./lib/api/audit.js";
import { ColleagueEngine } from "./lib/agents/colleagues.js";
import type {
  ScheduleService,
  ScheduledTask,
} from "./lib/schedule/scheduler.js";
import { randomUUID } from "crypto";
import type { ResponsePayload } from "./lib/api/audit.js";
import { getConfig, loadPersisted } from "./lib/core/config.js";
import { registerRoutes } from "./lib/api/routes.js";
import { initDb } from "./lib/data/db.js";
import { initChatHistory } from "./lib/data/chat-history.js";
import { initAttachmentStore } from "./lib/data/attachment-store.js";
import { createContext } from "./lib/agents/context.js";
import { initColleagueStore } from "./lib/data/colleagues-store.js";
import { initScheduleStore } from "./lib/data/schedule-store.js";
import { initMCPConnectionsStore } from "./lib/data/mcp-connections-store.js";
import { createEventQueue } from "./lib/events/event-queue.js";
import { initRedis } from "./lib/data/redis.js";
import { initKillSwitch } from "./lib/agents/kill-switch.js";
import { env } from "./env.js";
import {
  getWorkspaceAttachmentsDir,
  WORKSPACE_ROOT,
  WORKSPACE_MCPCWD,
} from "./lib/core/workspace.js";
import { mkdirSync } from "fs";

const ATTACHMENTS_DATA_DIR = getWorkspaceAttachmentsDir();
// Ensure workspace dirs exist (config, db, memory, attachments, MCP cwd)
mkdirSync(WORKSPACE_ROOT, { recursive: true });
mkdirSync(WORKSPACE_MCPCWD, { recursive: true });

await loadPersisted();

if (!env.REDIS_URL) {
  console.error(
    "REDIS_URL is required. Set it in .env (e.g. redis://localhost:6379).",
  );
  process.exit(1);
}
const redisUrl = env.REDIS_URL;
initRedis(redisUrl);

const eventRouter = new EventRouter();
initKillSwitch(redisUrl);
const eventQueue = createEventQueue({ connection: redisUrl });
eventRouter.setQueueAdapter(eventQueue);
debug(
  "Event queue: Redis + BullMQ; kill switch in Redis; workers process events",
);

const config = getConfig();
const memory = await createMemoryService({
  openaiApiKey: config.OPENAI_API_KEY,
  embeddingModel: config.OPENAI_EMBEDDING_MODEL,
  llmModel: config.OPENAI_MODEL,
});

await initDb();
debug("Database (Prisma + SQLite) ready");

const chatHistory = await initChatHistory();
const attachmentStore = await initAttachmentStore(ATTACHMENTS_DATA_DIR);
const context = createContext(memory, chatHistory);

const colleagueStore = await initColleagueStore();
const colleagueEngine = new ColleagueEngine(colleagueStore);
await colleagueEngine.load();

const scheduleStore = await initScheduleStore();
const mcpConnectionsStore = await initMCPConnectionsStore();

/** Schedule CRUD only; node-schedule runs in the cron PM2 process. */
const scheduler: ScheduleService = {
  list: () => scheduleStore.getAll(),
  schedule: async (task: Omit<ScheduledTask, "id">) => {
    const id = randomUUID();
    await scheduleStore.add({ ...task, id });
    return id;
  },
  cancel: (id) => scheduleStore.remove(id),
};

const auditLog = new AuditLog();

// In-memory store for UI-bound responses (eventId -> messages)
const responseStore: Map<
  string,
  Array<{ role: "user" | "assistant"; text: string }>
> = new Map();

// Event processing runs only in the event-queue worker. API returns 202 + eventId; worker POSTs result to /api/internal/chat-result; API emits on Socket.IO so frontend gets the reply without blocking.
// Cron (node-schedule) runs in its own PM2 process and dispatches via POST /api/internal/dispatch.

auditLog.onResponseReceived((payload: ResponsePayload) => {
  if (payload.type === "response") {
    const list = responseStore.get(payload.eventId) ?? [];
    list.push({ role: "assistant", text: payload.text });
    responseStore.set(payload.eventId, list);
  }
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: true },
  path: "/socket.io",
});

registerRoutes(app, {
  eventRouter,
  context,
  auditLog,
  colleagueEngine,
  responseStore,
  scheduler,
  io,
  mcpConnectionsStore,
  attachmentStore,
});

const PORT = getConfig().PORT;
server.listen(PORT, () => {
  debug(
    "Hooman API listening on http://localhost:%s (Socket.IO on same server)",
    PORT,
  );
});
