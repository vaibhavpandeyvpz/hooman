import { stderr } from "node:process";
import type {
  ContentBlock,
  SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import {
  CONFIG_ID_EFFORT,
  CONFIG_ID_MODE,
  CONFIG_ID_MODEL,
  CONFIG_ID_YOLO,
} from "../acp/session-config.js";
import type { ChannelOrigin } from "../core/approvals/channel-ask.js";
import { HOOMAN_CHANNEL } from "../core/mcp/index.js";
import type {
  ChannelMessage,
  ChannelSubscription,
  Manager as McpManager,
} from "../core/mcp/index.js";
import type { AcpDaemonClient } from "./acp-client.js";
import { attachmentPathsToAcpBlocks } from "./attachments.js";
import type { DaemonMcpProxyServer } from "./mcproxy/index.js";
import { KeyedTurnQueue } from "./queue.js";
import type { DaemonSessionRegistry } from "./session-registry.js";

export type DaemonCliOverrides = {
  mode?: string;
  model?: string;
  effort?: string;
  yolo?: boolean;
};

export type RunDaemonOptions = {
  manager: McpManager;
  acpClient: AcpDaemonClient;
  registry: DaemonSessionRegistry;
  mcpServer: DaemonMcpProxyServer;
  cwd: string;
  /** Fallback external-session component when a notification carries no `hooman/session`. */
  session?: string;
  cliOverrides: DaemonCliOverrides;
  debug?: boolean;
};

function debug(text: string): void {
  stderr.write(`[daemon] ${text}\n`);
}

function resolveExternalKey(
  message: ChannelMessage,
  cliSessionFallback?: string,
): string {
  const { server, channel } = message.meta.subscription;
  const raw = message.meta.session?.trim() || cliSessionFallback?.trim();
  return raw ? `${server}:${channel}:${raw}` : `${server}:${channel}`;
}

function resolveUserId(message: ChannelMessage, externalKey: string): string {
  const raw = message.meta.user?.trim();
  return raw ? `${message.meta.subscription.server}:${raw}` : externalKey;
}

function buildOrigin(message: ChannelMessage): ChannelOrigin {
  return {
    server: message.meta.subscription.server,
    ...(message.meta.source ? { source: message.meta.source } : {}),
    ...(message.meta.user ? { user: message.meta.user } : {}),
    ...(message.meta.session ? { session: message.meta.session } : {}),
    ...(message.meta.thread ? { thread: message.meta.thread } : {}),
  };
}

async function toPromptBlocks(
  message: ChannelMessage,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [{ type: "text", text: message.prompt }];
  if (message.attachments.length > 0) {
    blocks.push(...(await attachmentPathsToAcpBlocks(message.attachments)));
  }
  return blocks;
}

function formatSubscriptions(
  subscriptions: readonly ChannelSubscription[],
): string {
  if (subscriptions.length === 0) {
    return "none";
  }
  const servers = [
    ...new Set(subscriptions.map((subscription) => subscription.server)),
  ].sort((left, right) => left.localeCompare(right));
  return `${servers.length} MCP server(s): ${servers.join(", ")}`;
}

async function applyCliOverrides(
  acpClient: AcpDaemonClient,
  sessionId: string,
  overrides: DaemonCliOverrides,
): Promise<void> {
  const requests: SetSessionConfigOptionRequest[] = [];
  if (overrides.mode) {
    requests.push({
      sessionId,
      configId: CONFIG_ID_MODE,
      value: overrides.mode,
    });
  }
  if (overrides.model) {
    requests.push({
      sessionId,
      configId: CONFIG_ID_MODEL,
      value: overrides.model,
    });
  }
  if (overrides.effort) {
    requests.push({
      sessionId,
      configId: CONFIG_ID_EFFORT,
      value: overrides.effort,
    });
  }
  if (overrides.yolo) {
    requests.push({
      sessionId,
      configId: CONFIG_ID_YOLO,
      type: "boolean",
      value: true,
    });
  }
  for (const request of requests) {
    await acpClient.setConfigOption(request);
  }
}

export async function main(options: RunDaemonOptions): Promise<void> {
  const channels = [HOOMAN_CHANNEL];
  debug(`starting daemon for channel(s): ${channels.join(", ")}`);

  const queue = new KeyedTurnQueue();

  async function ensureAcpSession(
    externalKey: string,
    userId: string,
    origin: ChannelOrigin,
  ): Promise<string> {
    if (options.registry.hasRuntime(externalKey)) {
      options.registry.markBusy(externalKey);
      return options.registry.acpSessionIdFor(externalKey)!;
    }

    const meta = { "hooman/userId": userId, "hooman/origin": origin };
    const persisted = options.registry.persistedAcpSessionId(externalKey);
    let acpSessionId: string;
    if (persisted) {
      try {
        await options.acpClient.resumeSession({
          sessionId: persisted,
          cwd: options.cwd,
          mcpServers: [options.mcpServer],
          meta,
        });
        acpSessionId = persisted;
      } catch {
        debug(
          `resume failed for ${externalKey} (${persisted}); creating a replacement session`,
        );
        const created = await options.acpClient.newSession({
          cwd: options.cwd,
          mcpServers: [options.mcpServer],
          meta,
        });
        acpSessionId = created.sessionId;
        await options.registry.persistBinding({
          externalKey,
          acpSessionId,
          cwd: options.cwd,
          userId,
        });
      }
    } else {
      const created = await options.acpClient.newSession({
        cwd: options.cwd,
        mcpServers: [options.mcpServer],
        meta,
      });
      acpSessionId = created.sessionId;
      await options.registry.persistBinding({
        externalKey,
        acpSessionId,
        cwd: options.cwd,
        userId,
      });
    }

    await applyCliOverrides(
      options.acpClient,
      acpSessionId,
      options.cliOverrides,
    );
    options.registry.registerActive({
      externalKey,
      acpSessionId,
      cwd: options.cwd,
      userId,
      origin,
    });
    return acpSessionId;
  }

  async function runTurn(message: ChannelMessage): Promise<void> {
    const tag = `${message.meta.subscription.server}:${message.meta.subscription.channel}`;
    const externalKey = resolveExternalKey(message, options.session);
    const userId = resolveUserId(message, externalKey);
    const origin = buildOrigin(message);

    if (options.registry.isShuttingDown) {
      return;
    }
    await options.registry.acquireSlot(externalKey);
    if (options.registry.isShuttingDown) {
      return;
    }
    options.registry.updateOrigin(externalKey, origin);

    debug(`dequeued → ${tag} session=${externalKey} user=${userId}`);
    if (options.debug) {
      debug(`raw → ${JSON.stringify(message.meta)}`);
    }

    let acpSessionId: string;
    try {
      acpSessionId = await ensureAcpSession(externalKey, userId, origin);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug(`session setup failed → ${externalKey}: ${text}`);
      options.registry.markIdle(externalKey, queue.length(externalKey) > 1);
      return;
    }

    try {
      debug(
        `invoking agent → ${tag} session=${externalKey} acp=${acpSessionId}`,
      );
      const prompt = await toPromptBlocks(message);
      await options.acpClient.prompt({
        sessionId: acpSessionId,
        prompt,
        meta: { "hooman/origin": origin },
      });
      debug(`completed → ${tag} session=${externalKey} acp=${acpSessionId}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug(
        `turn failed → ${tag} session=${externalKey} acp=${acpSessionId}: ${text}`,
      );
    } finally {
      options.registry.markIdle(externalKey, queue.length(externalKey) > 1);
    }
  }

  const handle = await options.manager.subscribeToChannels(
    channels,
    (message) => {
      debug(
        `received notification → ${message.meta.subscription.server}:${message.meta.subscription.channel}`,
      );
      queue.push(resolveExternalKey(message, options.session), () =>
        runTurn(message),
      );
    },
  );
  debug(`subscribed → ${formatSubscriptions(handle.subscriptions)}`);

  const stopper = new Promise<void>((resolve) => {
    const shutdown = () => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  try {
    await stopper;
  } finally {
    debug("stopping daemon");
    handle.unsubscribe();
    await queue.drain();
    await options.registry.shutdown();
  }
}
