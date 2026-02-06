/**
 * BullMQ-backed event queue. Redis is required. Uses shared client from data/redis when
 * connection is a URL. API, cron, and channel listeners only push events; the event-queue
 * worker process is the only one that runs agents.
 */
import createDebug from "debug";
import { Queue, Worker } from "bullmq";
import type { NormalizedEvent } from "../core/types.js";
import { initRedis, getRedis } from "../data/redis.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";

const debug = createDebug("hooman:event-queue");

const QUEUE_NAME = "hooman-events";

export interface EventQueueOptions {
  /** Redis URL (e.g. redis://localhost:6379) or connection object for BullMQ. */
  connection: { host?: string; port?: number; password?: string } | string;
}

export interface EventQueueAdapter {
  /** Add a normalized event to the queue. Returns job id (same as event.id for correlation). */
  add(event: NormalizedEvent): Promise<string>;
  /** Start the worker that processes events. Call once after all handlers are registered. */
  startWorker(processor: (event: NormalizedEvent) => Promise<void>): void;
  /** Close queue and worker. Does not close the shared Redis client. */
  close(): Promise<void>;
}

function connectionFromOpts(opts: EventQueueOptions["connection"]): {
  host: string;
  port: number;
  password?: string;
} {
  if (typeof opts === "string") {
    const u = new URL(opts);
    return {
      host: u.hostname || "localhost",
      port: u.port ? parseInt(u.port, 10) : 6379,
      password: u.password || undefined,
    };
  }
  return {
    host: opts.host ?? "localhost",
    port: opts.port ?? 6379,
    password: opts.password,
  };
}

/**
 * Create a BullMQ-backed event queue and worker. When connection is a URL, uses the shared
 * Redis client from data/redis (initRedis must be called before createEventQueue).
 */
export function createEventQueue(
  options: EventQueueOptions,
): EventQueueAdapter {
  const connection =
    typeof options.connection === "string"
      ? (initRedis(options.connection),
        getRedis() ?? connectionFromOpts(options.connection))
      : connectionFromOpts(options.connection);

  const queue = new Queue<NormalizedEvent>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  let worker: Worker<NormalizedEvent, void> | null = null;

  return {
    async add(event: NormalizedEvent): Promise<string> {
      const job = await queue.add("event", event, {
        jobId: event.id,
        priority: event.priority ?? 5,
      });
      return job.id ?? event.id;
    },

    startWorker(processor: (event: NormalizedEvent) => Promise<void>): void {
      if (worker) {
        debug("Event queue worker already started");
        return;
      }
      worker = new Worker<NormalizedEvent, void>(
        QUEUE_NAME,
        async (job) => {
          if (getKillSwitchEnabled()) {
            debug("Kill switch on, skipping job %s", job.id);
            return;
          }
          await processor(job.data);
        },
        {
          connection,
          concurrency: 1,
        },
      );
      worker.on("completed", (job) => {
        debug("Event job %s completed", job.id);
      });
      worker.on("failed", (job, err) => {
        debug("Event job %s failed: %o", job?.id, err);
      });
      debug("Event queue worker started (concurrency 1)");
    },

    async close(): Promise<void> {
      if (worker) {
        await worker.close();
        worker = null;
      }
      await queue.close();
    },
  };
}
