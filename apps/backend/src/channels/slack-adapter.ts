/**
 * Slack channel adapter: Socket Mode, listens for messages in DMs/channels/groups
 * where the app is present, dispatches message.sent with channelMeta. Inbound only.
 * Handles text messages only.
 */
import createDebug from "debug";
import type {
  EventDispatcher,
  SlackChannelMeta,
  SlackChannelConfig,
  SlackUserProfile,
} from "../types.js";
import { App } from "@slack/bolt";

const debug = createDebug("hooman:slack-adapter");

let slackApp: App | null = null;

import { applyFilter } from "./shared.js";

/** Match if any filter-list entry equals the conversation (channel) or the sender (user). */
function applySlackFilter(
  config: SlackChannelConfig,
  channelId: string,
  userId: string,
): boolean {
  return applyFilter(
    config,
    (entry) => entry === channelId || entry === userId,
  );
}

export interface SlackAdapterOptions {
  /** Called when agent identity (and optional profile) is resolved from Slack API so the worker can persist to config. */
  onAgentIdentityResolved?: (
    userId: string,
    profile?: SlackUserProfile,
  ) => void;
}

export async function startSlackAdapter(
  dispatcher: EventDispatcher,
  getSlackConfig: () => SlackChannelConfig | undefined,
  options?: SlackAdapterOptions,
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
  const app = new App({
    appToken: config.appToken.trim(),
    token: config.userToken.trim(),
    socketMode: true,
  });

  let agentIdentity = config.agentIdentity?.trim();
  let profile: SlackUserProfile | undefined = config.profile;
  const hasProfile =
    profile && (profile.real_name || profile.name || profile.display_name);

  async function fetchProfileForUser(
    userId: string,
  ): Promise<SlackUserProfile | undefined> {
    try {
      const userInfo = await app.client.users.info({ user: userId });
      const u = (userInfo as { user?: Record<string, unknown> }).user;
      const prof = u?.profile as
        | { display_name?: string; real_name?: string }
        | undefined;
      if (!u) return undefined;
      return {
        real_name: (u.real_name as string) || prof?.real_name || undefined,
        name: (u.name as string) || undefined,
        display_name: prof?.display_name || undefined,
      };
    } catch (e) {
      debug("users.info for agent profile failed: %o", e);
      return undefined;
    }
  }

  if (!agentIdentity) {
    try {
      const auth = await app.client.auth.test();
      agentIdentity = (auth as { user_id?: string }).user_id ?? "";
      if (agentIdentity) {
        profile = await fetchProfileForUser(agentIdentity);
        if (options?.onAgentIdentityResolved) {
          options.onAgentIdentityResolved(agentIdentity, profile);
        }
      }
    } catch (e) {
      debug("auth.test failed, agentIdentity unknown: %o", e);
    }
  } else if (!hasProfile && options?.onAgentIdentityResolved) {
    profile = await fetchProfileForUser(agentIdentity);
    if (
      profile &&
      (profile.real_name || profile.name || profile.display_name)
    ) {
      options.onAgentIdentityResolved(agentIdentity, profile);
    }
  }

  /** Extract Slack user IDs mentioned in text (<@U123>). */
  function extractMentionedIds(text: string): string[] {
    const ids: string[] = [];
    const re = /<@([A-Z0-9]+)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = m[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  app.message(async ({ message, client }) => {
    if (
      message.subtype === "bot_message" ||
      (message as { bot_id?: string }).bot_id
    ) {
      debug(
        "Ignoring Slack message from self (bot), not queuing: channel=%s",
        (message as { channel?: string }).channel,
      );
      return;
    }
    const text =
      typeof (message as { text?: string }).text === "string"
        ? (message as { text: string }).text
        : "";

    const channelId = (message as { channel: string }).channel;
    const messageTs = (message as { ts: string }).ts;
    const threadTs = (message as { thread_ts?: string }).thread_ts;
    const userIdFromSlack = (message as { user?: string }).user ?? "";

    if (agentIdentity && userIdFromSlack === agentIdentity) {
      debug(
        "Ignoring Slack message from self (designated user), not queuing: channel=%s user=%s",
        channelId,
        userIdFromSlack,
      );
      return;
    }

    if (!applySlackFilter(config, channelId, userIdFromSlack)) {
      debug(
        "Slack message filtered out: channel=%s user=%s",
        channelId,
        userIdFromSlack,
      );
      return;
    }

    if (!text.trim()) return;

    const isDm = channelId.startsWith("D");
    const userId = threadTs
      ? `slack:${channelId}:${threadTs}`
      : `slack:${channelId}`;

    const mentionedIds = extractMentionedIds(text);
    const selfMentioned =
      !!agentIdentity && mentionedIds.includes(agentIdentity);
    const isDirect =
      isDm ||
      (typeof (message as { text?: string }).text === "string" &&
        agentIdentity &&
        (message as { text: string }).text.includes(`<@${agentIdentity}>`));
    const directness = isDirect ? "direct" : "neutral";
    const directnessReason = isDm
      ? "dm"
      : isDirect
        ? "mention"
        : channelId.startsWith("G")
          ? "group_message"
          : "channel_message";

    const destinationType = isDm
      ? "dm"
      : channelId.startsWith("G")
        ? "group"
        : "channel";

    let senderName: string | undefined;
    try {
      const u = await client.users.info({ user: userIdFromSlack });
      senderName = (u.user as { real_name?: string })?.real_name;
    } catch {
      // ignore
    }

    let replyInThread = true;
    try {
      const conv = await client.conversations.info({ channel: channelId });
      const ch = conv.channel as { is_im?: boolean; is_mpim?: boolean };
      replyInThread = !(ch?.is_im || ch?.is_mpim);
    } catch {
      // fallback: use thread when available
    }

    let originalMessage: SlackChannelMeta["originalMessage"];
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

    const channelMeta: SlackChannelMeta = {
      channel: "slack",
      channelId,
      messageTs,
      senderId: userIdFromSlack,
      destinationType,
      directness,
      directnessReason,
      replyInThread,
      ...(threadTs ? { threadTs } : {}),
      ...(senderName ? { senderName } : {}),
      ...(mentionedIds.length > 0 ? { mentionedIds } : {}),
      ...(selfMentioned ? { selfMentioned: true } : {}),
      ...(agentIdentity ? { yourSlackUserId: agentIdentity } : {}),
      ...(config.profile &&
      (config.profile.real_name ||
        config.profile.name ||
        config.profile.display_name)
        ? { yourSlackUserProfile: config.profile }
        : {}),
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

/**
 * Send a message to a Slack channel. Used by response delivery (event-queue publishes; slack worker subscribes).
 * When threadTs is provided, posts in thread; otherwise posts to channel root (e.g. for im/mpim).
 */
export async function sendMessageToChannel(
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const app = slackApp;
  if (!app?.client) {
    throw new Error("Slack adapter not started or client unavailable");
  }
  await app.client.chat.postMessage({
    channel: channelId,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}
