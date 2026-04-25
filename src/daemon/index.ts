import { stderr } from "node:process";
import {
  Message,
  TextBlock,
  type Agent,
  type ContentBlock,
} from "@strands-agents/sdk";
import { HOOMAN_CHANNEL } from "../core/mcp/index.ts";
import type {
  ChannelMessage,
  ChannelSubscription,
  Manager as McpManager,
} from "../core/mcp/index.ts";
import { attachmentPathsToPromptBlocks } from "../core/utils/attachments.ts";
import { createQueue } from "./queue.ts";

type RunDaemonOptions = {
  agent: Agent;
  manager: McpManager;
  session?: string;
  channels: boolean;
  debug?: boolean;
};

const MAX_ATTACHMENT_BYTES = 1024 * 1024;

function debug(text: string): void {
  stderr.write(`[daemon] ${text}\n`);
}

function resolveSessionId(
  message: ChannelMessage,
  fallback?: string,
): string | undefined {
  const raw = message.meta.identity.session?.trim() || fallback;
  if (!raw) return undefined;
  // Namespace per `server:channel` so the same chat id coming from two
  // different MCP servers (or two channels on the same server) never collide.
  return `${message.meta.server}:${message.meta.channel}:${raw}`;
}

function resolveUserId(
  message: ChannelMessage,
  session?: string,
): string | undefined {
  const raw = message.meta.identity.user?.trim();
  if (!raw) return session;
  // Same user id across different servers is not the same human, so scope
  // user ids by server. Channel is intentionally omitted so long-term memory
  // can stay consistent for a user across rooms within one server.
  return `${message.meta.server}:${raw}`;
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

async function toInvokeInput(
  message: ChannelMessage,
): Promise<string | Message[]> {
  if (message.attachments.length === 0) {
    return message.prompt;
  }
  const blocks: ContentBlock[] = [new TextBlock(message.prompt)];
  const attachmentBlocks = await attachmentPathsToPromptBlocks(
    message.attachments,
    {
      maxBytes: MAX_ATTACHMENT_BYTES,
    },
  );
  blocks.push(...attachmentBlocks);
  return [new Message({ role: "user", content: blocks })];
}

export async function main(options: RunDaemonOptions): Promise<void> {
  if (!options.channels) {
    throw new Error("No daemon inputs enabled. Pass --channels.");
  }
  const channels = [HOOMAN_CHANNEL];
  debug(`starting daemon for channel(s): ${channels.join(", ")}`);

  let unsubscribe = () => {};

  const [queue, stop] = await createQueue(
    async (message: ChannelMessage) => {
      const tag = `${message.meta.server}:${message.meta.channel}`;
      const session = resolveSessionId(message, options.session);
      const user = resolveUserId(message, session);

      debug(`dequeued → ${tag} session=${session} user=${user}`);
      if (options.debug) {
        debug(`raw → ${JSON.stringify(message.meta)}`);
      }

      options.agent.appState.set("userId", user);
      options.agent.appState.set("sessionId", session);
      const origin = {
        server: message.meta.server,
        channel: message.meta.channel,
        ...(message.meta.source ? { source: message.meta.source } : {}),
        ...(message.meta.identity.user
          ? { user: message.meta.identity.user }
          : {}),
        ...(message.meta.identity.session
          ? { session: message.meta.identity.session }
          : {}),
        ...(message.meta.identity.thread
          ? { thread: message.meta.identity.thread }
          : {}),
      };
      options.agent.appState.set("origin", {
        ...origin,
      });

      try {
        debug(`invoking agent → ${tag} session=${session} user=${user}`);
        const invokeInput = await toInvokeInput(message);
        if (typeof invokeInput === "string") {
          await options.agent.invoke(invokeInput);
        } else {
          for await (const event of options.agent.stream(invokeInput)) {
            void event;
          }
        }
        debug(`completed → ${tag} session=${session} user=${user}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        debug(`turn failed → ${tag} session=${session} user=${user}: ${text}`);
      }
    },
    () => unsubscribe(),
  );

  const handle = await options.manager.subscribeToChannels(
    channels,
    (message) => {
      debug(
        `received notification → ${message.meta.server}:${message.meta.channel}`,
      );
      void queue.push(message);
    },
  );
  unsubscribe = handle.unsubscribe;
  debug(`subscribed → ${formatSubscriptions(handle.subscriptions)}`);

  try {
    await stop();
  } finally {
    debug("stopping daemon");
  }
}
