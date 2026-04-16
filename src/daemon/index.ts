import { stderr } from "node:process";
import { BeforeToolCallEvent, type Agent } from "@strands-agents/sdk";
import type {
  ChannelMessage,
  Manager as McpManager,
} from "../core/mcp/index.ts";
import { createQueue } from "./queue.ts";

type RunDaemonOptions = {
  agent: Agent;
  manager: McpManager;
  channels: string[];
};

function debug(text: string): void {
  stderr.write(`[daemon] ${text}\n`);
}

export async function main(options: RunDaemonOptions): Promise<void> {
  const channels = [
    ...new Set(options.channels.map((value) => value.trim()).filter(Boolean)),
  ];
  if (channels.length === 0) {
    throw new Error("At least one --channel <name> is required.");
  }

  // Daemon mode is non-interactive: approve tool calls by default.
  options.agent.addHook(BeforeToolCallEvent, async () => {});

  let fasterq: Awaited<ReturnType<typeof createQueue>>[0] | null = null;

  const unsubscribe = await options.manager.subscribeToChannels(
    channels,
    (message) => {
      if (fasterq != null) {
        void fasterq.push(message);
      }
    },
  );

  const [queue, stop] = await createQueue(async (message: ChannelMessage) => {
    debug(`notification from ${message.meta.server}:${message.meta.channel}`);
    try {
      await options.agent.invoke(message.prompt);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug(
        `turn failed for ${message.meta.server}:${message.meta.channel}: ${text}`,
      );
    }
  }, unsubscribe);

  fasterq = queue;

  await stop();
}
