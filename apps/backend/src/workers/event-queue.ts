/**
 * Event-queue worker: runs the BullMQ worker that processes events (chat, scheduled tasks).
 * Agents run here. Publishes responses to Redis (hooman:response_delivery); API/Slack/WhatsApp subscribers deliver accordingly.
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only event-queue).
 */
import createDebug from "debug";
import { mkdirSync } from "fs";
import { loadPersisted } from "../config.js";
import { createEventQueue } from "../events/event-queue.js";
import { EventRouter } from "../events/event-router.js";
import { registerEventHandlers } from "../events/event-handlers.js";
import { AuditLog } from "../audit/audit.js";
import { createContext } from "../chats/context.js";
import { initMCPConnectionsStore } from "../capabilities/mcp/connections-store.js";
import { createDiscoveredToolsStore } from "../capabilities/mcp/discovered-tools-store.js";
import { initSkillSettingsStore } from "../capabilities/skills/skills-settings-store.js";
import { createSkillService } from "../capabilities/skills/skills-service.js";
import { initDb } from "../data/db.js";
import { initChatHistory } from "../chats/chat-history.js";
import { createAuditStore } from "../audit/audit-store.js";
import { initRedis, closeRedis } from "../data/redis.js";
import { initKillSwitch, closeKillSwitch } from "../agents/kill-switch.js";
import {
  initToolApproval,
  closeToolApproval,
  getToolApprovalAllowEverything,
} from "../agents/tool-approval.js";
import {
  createHoomanRunner,
  type HoomanRunner,
} from "../agents/hooman-runner.js";
import { McpManager } from "../capabilities/mcp/manager.js";
import { createToolSettingsStore } from "../capabilities/mcp/tool-settings-store.js";
import {
  publish,
  createSubscriber,
  createRpcMessageHandler,
  RESTART_WORKERS_CHANNEL,
} from "../utils/pubsub.js";
import { env } from "../env.js";
import { RESPONSE_DELIVERY_CHANNEL } from "../types.js";
import { loadPrompts } from "../utils/prompts.js";
import {
  WORKSPACE_ROOT,
  WORKSPACE_MCPCWD,
  getWorkspaceAttachmentsDir,
} from "../utils/workspace.js";
import { initAttachmentStore } from "../attachments/attachment-store.js";
import { createAttachmentService } from "../attachments/attachment-service.js";

const debug = createDebug("hooman:workers:event-queue");

async function main() {
  if (!env.REDIS_URL) {
    debug("REDIS_URL is required for the event-queue worker. Set it in .env.");
    process.exit(1);
  }

  await loadPersisted();
  await loadPrompts();
  mkdirSync(WORKSPACE_ROOT, { recursive: true });
  mkdirSync(WORKSPACE_MCPCWD, { recursive: true });
  await initDb();
  initRedis(env.REDIS_URL);
  initKillSwitch(env.REDIS_URL);
  initToolApproval(env.REDIS_URL);

  const chatHistory = await initChatHistory();
  const attachmentStore = await initAttachmentStore(
    getWorkspaceAttachmentsDir(),
  );
  const attachmentService = createAttachmentService(attachmentStore);
  const context = await createContext(chatHistory);
  const mcpConnectionsStore = await initMCPConnectionsStore();
  const skillSettingsStore = await initSkillSettingsStore();
  const auditStore = createAuditStore();
  const auditLog = new AuditLog(auditStore);

  const discoveredToolsStore = createDiscoveredToolsStore({
    onReplaceAll: () =>
      publish("hooman:mcp-tools-reloaded", JSON.stringify({})),
  });
  const mcpManager = new McpManager(mcpConnectionsStore, {
    connectTimeoutMs: env.MCP_CONNECT_TIMEOUT_MS,
    closeTimeoutMs: env.MCP_CLOSE_TIMEOUT_MS,
    discoveredToolsStore,
  });
  const toolSettingsStore = createToolSettingsStore();
  debug("MCP manager enabled");

  /** Same prefix logic as mcp-service clientsToTools (shortId_safeName, max 64 chars). */
  function prefixedNameForTool(connectionId: string, name: string): string {
    const shortConnIdLen = 8;
    const maxToolNameLen = 64;
    const shortId = connectionId.replace(/-/g, "").slice(0, shortConnIdLen);
    const maxNameLen = maxToolNameLen - shortId.length - 1;
    const safeName =
      name.length <= maxNameLen ? name : name.slice(0, maxNameLen);
    return `${shortId}_${safeName}`;
  }

  let runnerCache: HoomanRunner | null = null;
  const skillService = createSkillService(skillSettingsStore);
  const getRunner = async (): Promise<HoomanRunner> => {
    if (runnerCache) return runnerCache;
    const { agentTools, tools } = await mcpManager.tools();
    const [disabledSet, allowEveryTimeSet] = await Promise.all([
      toolSettingsStore.getDisabledToolIds(),
      toolSettingsStore.getAllowEveryTimeToolIds(),
    ]);
    const allowEverything = getToolApprovalAllowEverything();

    const prefixedNameToToolId = new Map<string, string>();
    for (const t of tools) {
      prefixedNameToToolId.set(
        prefixedNameForTool(t.connectionId, t.name),
        t.id,
      );
    }

    const filteredAgentTools: Record<string, unknown> = {};
    for (const [prefixedName, tool] of Object.entries(agentTools)) {
      const toolId = prefixedNameToToolId.get(prefixedName);
      if (toolId != null && disabledSet.has(toolId)) continue;
      filteredAgentTools[prefixedName] = tool;
    }

    const toolsThatNeedApproval = new Set<string>();
    if (!allowEverything) {
      for (const prefixedName of Object.keys(filteredAgentTools)) {
        const toolId = prefixedNameToToolId.get(prefixedName);
        if (toolId != null && !allowEveryTimeSet.has(toolId)) {
          toolsThatNeedApproval.add(prefixedName);
        }
      }
    }

    runnerCache = await createHoomanRunner({
      agentTools: filteredAgentTools,
      toolsThatNeedApproval,
      prefixedNameToToolId,
      auditLog,
      skillService,
    });
    return runnerCache;
  };

  // Start/cache MCP manager tools
  await mcpManager.tools();

  // Handle synchronous MCP reload RPC from the API (Tools tab refresh)
  const mcpReloadSub = createSubscriber();
  if (mcpReloadSub) {
    const handler = createRpcMessageHandler(
      "hooman:mcp-reload:response",
      async () => {
        debug("MCP reload RPC received; re-reading config");
        await loadPersisted();
        mcpManager.clearCache();
        runnerCache = null;
        await mcpManager.tools();
        debug("MCP manager reloaded via RPC");
        return { ok: true };
      },
    );
    mcpReloadSub.subscribe("hooman:mcp-reload:request", handler);
    mcpReloadSub.subscribe("hooman:runner-cache-invalidate", () => {
      runnerCache = null;
      debug(
        "Runner cache invalidated (e.g. Safety page reset allow-every-time)",
      );
    });
    debug("Subscribed to hooman:mcp-reload:request for MCP reload RPC");
  }

  const eventRouter = new EventRouter();
  registerEventHandlers({
    eventRouter,
    context,
    auditLog,
    publishResponse: (payload) => {
      publish(RESPONSE_DELIVERY_CHANNEL, JSON.stringify(payload));
    },
    getRunner,
    attachmentService,
    toolSettingsStore,
    invalidateRunnerCache: () => {
      runnerCache = null;
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
    "Event-queue worker started (agents run here); responses via %s",
    RESPONSE_DELIVERY_CHANNEL,
  );

  const shutdown = async () => {
    debug("Shutting down event-queue worker\u2026");
    if (mcpReloadSub) await mcpReloadSub.close();
    await closeKillSwitch();
    await closeToolApproval();
    await eventQueue.close();
    await mcpManager?.shutdown();
    await closeRedis();
    process.exit(0);
  };
  if (mcpReloadSub)
    mcpReloadSub.subscribe(RESTART_WORKERS_CHANNEL, () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  debug("Event-queue worker failed: %o", err);
  process.exit(1);
});
