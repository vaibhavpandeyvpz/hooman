/**
 * Slack worker: runs the Slack channel adapter (Socket Mode), enqueues message events directly to BullMQ.
 * Subscribes to Redis for response delivery (hooman:response_delivery) and sends replies via chat.postMessage.
 * Respects channel on/off: at startup and when Redis reload flag is set (e.g. after PATCH /api/channels).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only slack).
 */
import createDebug from "debug";
import { getChannelsConfig, updateChannelsConfig } from "../config.js";
import {
  startSlackAdapter,
  stopSlackAdapter,
  sendMessageToChannel,
  setAssistantThreadStatus,
} from "../channels/slack-adapter.js";
import { createEventQueue } from "../events/event-queue.js";
import {
  createQueueDispatcher,
  type QueueDispatcher,
} from "../events/enqueue.js";
import { createSubscriber } from "../utils/pubsub.js";
import { env } from "../env.js";
import { RESPONSE_DELIVERY_CHANNEL } from "../types.js";
import { runWorker } from "./bootstrap.js";
import { initAttachmentStore } from "../attachments/attachment-store.js";
import { createAttachmentService } from "../attachments/attachment-service.js";
import { getWorkspaceAttachmentsDir } from "../utils/workspace.js";

const debug = createDebug("hooman:workers:slack");

let eventQueue: ReturnType<typeof createEventQueue> | null = null;
let dispatcher: QueueDispatcher | null = null;
let responseDeliverySubscriber: ReturnType<typeof createSubscriber> | null =
  null;

async function startAdapter(): Promise<void> {
  await stopSlackAdapter();
  if (!env.REDIS_URL) {
    debug("REDIS_URL required for Slack worker");
    return;
  }
  if (!eventQueue) {
    eventQueue = createEventQueue({ connection: env.REDIS_URL });
  }
  if (dispatcher?.close) {
    await dispatcher.close();
  }
  dispatcher = createQueueDispatcher(eventQueue, {
    debounce: {
      connection: env.REDIS_URL,
      windowsMs: {
        slack: env.SLACK_MESSAGE_DEBOUNCE_MS,
      },
    },
  });
  const attachmentStore = await initAttachmentStore(
    getWorkspaceAttachmentsDir(),
  );
  const attachmentService = createAttachmentService(attachmentStore);
  try {
    await startSlackAdapter(dispatcher, () => getChannelsConfig().slack, {
      attachmentService,
      onAgentIdentityResolved(userId, profile) {
        const current = getChannelsConfig();
        if (current.slack) {
          updateChannelsConfig({
            slack: {
              ...current.slack,
              agentIdentity: userId,
              ...(profile && Object.values(profile).some(Boolean)
                ? { profile }
                : {}),
            },
          });
          debug("Slack agent identity saved: %s", userId);
        }
      },
    });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    debug("Slack adapter failed to start: %s", msg);
    if (msg.includes("invalid_auth")) {
      debug(
        "Slack auth failed (invalid_auth). Check appToken/userToken in Settings and reinstall app if needed.",
      );
    }
    // Keep worker alive so credentials can be fixed and reloaded.
    return;
  }

  if (responseDeliverySubscriber) {
    await responseDeliverySubscriber.close();
    responseDeliverySubscriber = null;
  }
  responseDeliverySubscriber = createSubscriber();
  if (responseDeliverySubscriber) {
    responseDeliverySubscriber.subscribe(
      RESPONSE_DELIVERY_CHANNEL,
      (raw: string) => {
        try {
          const payload = JSON.parse(raw) as {
            channel?: string;
            channelId?: string;
            threadTs?: string;
            text?: string;
            typing?: "start" | "stop";
            status?: { label?: string; done?: boolean };
          };
          if (payload.channel !== "slack") return;
          const channelId = payload.channelId;
          if (typeof channelId !== "string") return;
          const connectAs = getChannelsConfig().slack?.connectAs ?? "bot";
          if (connectAs === "bot" && payload.status && payload.threadTs) {
            const label =
              payload.status.done === true
                ? ""
                : String(payload.status.label ?? "");
            setAssistantThreadStatus(channelId, payload.threadTs, label).catch(
              (err) => {
                debug(
                  "response_delivery slack assistant status error: %o",
                  err,
                );
              },
            );
            return;
          }
          const text = payload.text;
          if (typeof text !== "string") return;
          sendMessageToChannel(channelId, text, payload.threadTs).catch(
            (err) => {
              debug("response_delivery slack send error: %o", err);
            },
          );
        } catch (err) {
          debug("response_delivery parse/handle error: %o", err);
        }
      },
    );
    debug("Response delivery subscriber started");
  }
}

runWorker({
  name: "slack",
  reloadScopes: ["slack"],
  start: () => startAdapter(),
  stop: async () => {
    if (responseDeliverySubscriber) {
      await responseDeliverySubscriber.close();
      responseDeliverySubscriber = null;
    }
    if (eventQueue) {
      await eventQueue.close();
      eventQueue = null;
    }
    if (dispatcher?.close) {
      await dispatcher.close();
    }
    dispatcher = null;
    await stopSlackAdapter();
  },
  onReload: () => startAdapter(),
});
