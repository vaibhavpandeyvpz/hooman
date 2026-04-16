import fastq from "fastq";
import type { ChannelMessage } from "../core/mcp/index.ts";

type MessageQueue = fastq.queueAsPromised<ChannelMessage, void>;

export async function createQueue(
  handler: (message: ChannelMessage) => Promise<void>,
  cleanup: () => void,
): Promise<[MessageQueue, () => Promise<void>]> {
  let stopping = false;
  let resolver: (() => void) | null = null;
  const queue: MessageQueue = fastq.promise(async (message: ChannelMessage) => {
    await handler(message);
  }, 1);

  const stopper = new Promise<void>((resolve) => {
    resolver = resolve;
  });

  const shutdown = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    queue.kill();
    resolver?.();
  };

  const onSigInt = () => shutdown();
  const onSigTerm = () => shutdown();

  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigTerm);

  return [
    queue,
    async () => {
      try {
        await stopper;
      } finally {
        cleanup();
        await queue.drained().catch(() => {});
        process.off("SIGINT", onSigInt);
        process.off("SIGTERM", onSigTerm);
      }
    },
  ];
}
