/**
 * Slack channel adapter: Socket Mode, listens for messages in DMs/channels/groups
 * where the app is present, dispatches message.sent with channelMeta. Inbound only.
 */
import createDebug from "debug";
import type {
  EventDispatcher,
  ChannelMeta,
  SlackChannelConfig,
} from "../core/types.js";

const debug = createDebug("hooman:slack-adapter");

let slackApp: import("@slack/bolt").App | null = null;

function applyFilter(
  config: SlackChannelConfig,
  channelId: string,
  userId: string,
  isDm: boolean,
): boolean {
  const mode = config.filterMode ?? "all";
  if (mode === "all") return true;
  const list = config.filterList ?? [];
  const id = isDm ? userId : channelId;
  const inList = list.includes(id);
  if (mode === "allowlist") return inList;
  return !inList; // blocklist
}

export async function startSlackAdapter(
  dispatcher: EventDispatcher,
  getSlackConfig: () => SlackChannelConfig | undefined,
): Promise<void> {
  const config = getSlackConfig();
  if (
    !config?.enabled ||
    !config.appToken?.trim() ||
    !config.userToken?.trim()
  ) {
    debug("Slack adapter not started: disabled or missing appToken/userToken");
    return;
  }

  const { App } = await import("@slack/bolt");
  const app = new App({
    appToken: config.appToken.trim(),
    token: config.userToken.trim(),
    socketMode: true,
  });

  let designatedUserId = config.designatedUserId?.trim();
  if (!designatedUserId) {
    try {
      const auth = await app.client.auth.test();
      designatedUserId = (auth as { user_id?: string }).user_id ?? "";
    } catch (e) {
      debug("auth.test failed, designatedUserId unknown: %o", e);
    }
  }

  app.message(async ({ message, client }) => {
    if (
      message.subtype === "bot_message" ||
      (message as { bot_id?: string }).bot_id
    )
      return;
    const text =
      typeof (message as { text?: string }).text === "string"
        ? (message as { text: string }).text
        : "";
    if (!text.trim()) return;

    const channelId = (message as { channel: string }).channel;
    const messageTs = (message as { ts: string }).ts;
    const threadTs = (message as { thread_ts?: string }).thread_ts;
    const userIdFromSlack = (message as { user?: string }).user ?? "";

    const isDm = channelId.startsWith("D");
    if (!applyFilter(config, channelId, userIdFromSlack, isDm)) {
      debug(
        "Slack message filtered out: channel=%s user=%s",
        channelId,
        userIdFromSlack,
      );
      return;
    }

    const userId = threadTs
      ? `slack:${channelId}:${threadTs}`
      : `slack:${channelId}`;

    const isDirect =
      isDm ||
      (typeof (message as { text?: string }).text === "string" &&
        designatedUserId &&
        (message as { text: string }).text.includes(`<@${designatedUserId}>`));
    const directness = isDirect ? "direct" : "neutral";
    const directnessReason = isDm
      ? "dm"
      : isDirect
        ? "mention"
        : channelId.startsWith("G")
          ? "group_message"
          : "channel_message";

    let senderName: string | undefined;
    try {
      const u = await client.users.info({ user: userIdFromSlack });
      senderName = (u.user as { real_name?: string })?.real_name;
    } catch {
      // ignore
    }

    let originalMessage: ChannelMeta["originalMessage"] | undefined;
    if (threadTs && threadTs !== messageTs) {
      try {
        const thread = await client.conversations.history({
          channel: channelId,
          latest: threadTs,
          limit: 1,
          inclusive: true,
        });
        const parent = thread.messages?.[0] as
          | { user?: string; text?: string; ts?: string }
          | undefined;
        if (parent) {
          let parentSenderName: string | undefined;
          try {
            const pu = await client.users.info({ user: parent.user ?? "" });
            parentSenderName = (pu.user as { real_name?: string })?.real_name;
          } catch {
            // ignore
          }
          originalMessage = {
            senderId: parent.user,
            senderName: parentSenderName,
            content: parent.text,
            messageId: parent.ts,
            timestamp: parent.ts,
          };
        }
      } catch {
        // ignore
      }
    }

    const channelMeta: ChannelMeta = {
      channel: "slack",
      channelId,
      ...(threadTs ? { threadTs } : {}),
      messageTs,
      senderId: userIdFromSlack,
      ...(senderName ? { senderName } : {}),
      directness,
      directnessReason,
      ...(originalMessage ? { originalMessage } : {}),
    };

    await dispatcher.dispatch(
      {
        source: "slack",
        type: "message.sent",
        payload: { text: text.trim(), userId, channelMeta },
      },
      {},
    );
    debug(
      "Slack message.sent dispatched: channel=%s ts=%s",
      channelId,
      messageTs,
    );
  });

  await app.start();
  slackApp = app;
  debug("Slack adapter started (Socket Mode)");
}

export async function stopSlackAdapter(): Promise<void> {
  if (slackApp) {
    await slackApp.stop();
    slackApp = null;
    debug("Slack adapter stopped");
  }
}
