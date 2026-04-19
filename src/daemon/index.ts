import { stderr } from "node:process";
import type { Agent } from "@strands-agents/sdk";
import type {
  ChannelMessage,
  Manager as McpManager,
} from "../core/mcp/index.ts";
import { createQueue } from "./queue.ts";

type RunDaemonOptions = {
  agent: Agent;
  manager: McpManager;
  session?: string;
  channels: string[];
  debug?: boolean;
};

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

export async function main(options: RunDaemonOptions): Promise<void> {
  const channels = [
    ...new Set(options.channels.map((value) => value.trim()).filter(Boolean)),
  ];
  if (channels.length === 0) {
    throw new Error("At least one --channel <name> is required.");
  }
  debug(`starting daemon for channels: ${channels.join(", ")}`);

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

      try {
        await options.agent.invoke(message.prompt);
        debug(`completed → ${tag} session=${session} user=${user}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        debug(`turn failed → ${tag} session=${session} user=${user}: ${text}`);
      }
    },
    () => unsubscribe(),
  );

  unsubscribe = await options.manager.subscribeToChannels(
    channels,
    (message) => {
      debug(
        `received notification → ${message.meta.server}:${message.meta.channel}`,
      );
      void queue.push(message);
    },
  );
  debug(`subscribed to ${channels.length} channel(s)`);

  try {
    await stop();
  } finally {
    debug("stopping daemon");
  }
}
