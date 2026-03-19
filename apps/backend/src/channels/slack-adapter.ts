/**
 * Slack channel adapter: Socket Mode, listens for messages in DMs/channels/groups
 * where the app is present, dispatches message.sent with channelMeta. Inbound only.
 * channelMeta is {@link SlackChannelMeta}: message + profile only; routing is inferred from `message`.
 */
import createDebug from "debug";
import type { WebClient } from "@slack/web-api";
import type {
  EventDispatcher,
  SlackChannelMeta,
  SlackChannelConfig,
  SlackUserProfile,
  SavedAttachment,
  MessageEntity,
  SlackChannel,
  SlackMessage,
  SlackMessageWithParent,
} from "../types.js";
import { App } from "@slack/bolt";
import type { AttachmentService } from "../attachments/attachment-service.js";

const debug = createDebug("hooman:slack-adapter");

let slackApp: App | null = null;
let assistantStatusSupported = true;

import { applyFilter } from "./filter.js";

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

// --- Message building from Bolt event (merged from slack-message-from-event) ---
type SlackBlock = {
  type?: string;
  text?: { type?: string; text?: string };
  elements?: SlackBlock[];
};

type SlackFileInput = {
  url_private_download?: string;
  name?: string;
  mimetype?: string;
};

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks as SlackBlock[]) {
    if (block?.text?.text) parts.push(block.text.text);
    if (Array.isArray(block?.elements))
      parts.push(textFromBlocks(block.elements));
  }
  return parts.filter(Boolean).join("\n");
}

function slackChannelTypeFromId(channelId: string): SlackChannel["type"] {
  if (channelId.startsWith("D")) return "dm";
  if (channelId.startsWith("G")) return "group_chat";
  if (channelId.startsWith("C")) return "public_channel";
  return "private_channel";
}

function slackChannelEntity(
  channelId: string,
  displayName: string,
): SlackChannel {
  return {
    id: channelId,
    name: displayName.trim() || channelId,
    type: slackChannelTypeFromId(channelId),
  };
}

function isHtmlResponse(buf: Buffer): boolean {
  const start = buf.subarray(0, 100).toString("utf8").trimStart();
  return (
    start.startsWith("<!") ||
    start.startsWith("<?xml") ||
    start.toLowerCase().startsWith("<html")
  );
}

async function downloadSlackFilesToInbound(
  files: SlackFileInput[],
  token: string,
  userId: string,
  saveFiles: (
    userId: string,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ) => Promise<SavedAttachment[]>,
): Promise<{ savedAttachments: SavedAttachment[]; refs: SavedAttachment[] }> {
  const toSave: Array<{
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }> = [];
  for (const file of files) {
    const url = file.url_private_download;
    if (!url || typeof url !== "string") continue;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        debug(
          "Slack file download not ok for %s: %s %s",
          file.name,
          res.status,
          res.statusText,
        );
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const contentTypeHeader =
        res.headers.get("content-type")?.toLowerCase().split(";")[0].trim() ??
        "";
      if (contentTypeHeader === "text/html" || isHtmlResponse(buf)) {
        debug(
          "Slack file download returned HTML instead of file for %s (Content-Type: %s); skipping",
          file.name,
          res.headers.get("content-type") ?? "unknown",
        );
        continue;
      }
      const name =
        typeof file.name === "string" && file.name.trim()
          ? file.name.trim()
          : "file";
      const mime =
        typeof file.mimetype === "string" && file.mimetype.trim()
          ? file.mimetype.trim().toLowerCase().split(";")[0].trim()
          : "application/octet-stream";
      toSave.push({ buffer: buf, originalname: name, mimetype: mime });
    } catch (e) {
      debug("Slack file download failed for %s: %o", file.name, e);
    }
  }
  if (toSave.length === 0) return { savedAttachments: [], refs: [] };
  const saved = await saveFiles(userId, toSave);
  return { savedAttachments: saved, refs: saved };
}

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

async function resolveMentionEntities(
  client: WebClient,
  userIds: string[],
): Promise<MessageEntity[]> {
  const out: MessageEntity[] = [];
  for (const id of userIds) {
    if (!id.trim()) continue;
    try {
      const u = await client.users.info({ user: id });
      const user = u.user as { real_name?: string; name?: string } | undefined;
      const name = user?.real_name || user?.name || id;
      out.push({ name, id });
    } catch {
      out.push({ name: id, id });
    }
  }
  return out;
}

interface CreateSlackMessageFromEventDeps {
  token: string;
  client: WebClient;
  saveFiles: (
    userId: string,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ) => Promise<SavedAttachment[]>;
}

async function createSlackMessageFromEvent(
  message: Record<string, unknown>,
  deps: CreateSlackMessageFromEventDeps,
): Promise<{
  slackMessage: SlackMessageWithParent;
  attachments: SavedAttachment[];
  effectiveText: string;
  blocksSummary?: string;
  mentionedIds: string[];
} | null> {
  const { token, client, saveFiles } = deps;
  const rawText = typeof message.text === "string" ? message.text : "";
  const blocks = message.blocks as unknown;
  const blocksText = textFromBlocks(blocks);
  const effectiveText = [rawText.trim(), blocksText.trim()]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const hasBlocks = Array.isArray(blocks) && (blocks as unknown[]).length > 0;
  const blocksSummary =
    hasBlocks && !effectiveText
      ? "Message includes blocks or interactive content."
      : undefined;

  const channelId = message.channel as string;
  const messageTs = message.ts as string;
  const threadTs = message.thread_ts as string | undefined;
  const userIdFromSlack = typeof message.user === "string" ? message.user : "";
  const conversationUserId = threadTs
    ? `slack:${channelId}:${threadTs}`
    : `slack:${channelId}`;

  const messageFiles = (message.files as SlackFileInput[] | undefined) ?? [];
  let attachments: SavedAttachment[] = [];
  let attachmentRefs: SavedAttachment[] = [];
  if (Array.isArray(messageFiles) && messageFiles.length > 0) {
    const result = await downloadSlackFilesToInbound(
      messageFiles,
      token,
      conversationUserId,
      saveFiles,
    );
    attachments = result.savedAttachments;
    attachmentRefs = result.refs;
  }

  let parentSlackMessage: SlackMessage | null = null;
  if (threadTs && threadTs !== messageTs) {
    try {
      const thread = await client.conversations.history({
        channel: channelId,
        latest: threadTs,
        limit: 1,
        inclusive: true,
      });
      const parent = thread.messages?.[0];
      if (parent?.ts) {
        let parentSenderName = "";
        try {
          const pu = await client.users.info({ user: parent.user ?? "" });
          parentSenderName =
            (pu.user as { real_name?: string })?.real_name ||
            (pu.user as { name?: string })?.name ||
            parent.user ||
            "";
        } catch {
          parentSenderName = parent.user ?? "";
        }
        const parentFiles = Array.isArray(parent.files) ? parent.files : [];
        let parentRefs: SavedAttachment[] = [];
        if (parentFiles.length > 0) {
          const parentResult = await downloadSlackFilesToInbound(
            parentFiles,
            token,
            conversationUserId,
            saveFiles,
          );
          attachments = [
            ...attachments,
            ...parentResult.savedAttachments.map((a) => ({
              ...a,
              originalName: `thread_parent_${a.originalName}`,
            })),
          ];
          parentRefs = parentResult.refs;
        }
        const parentMentionIds = extractMentionedIds(parent.text ?? "");
        const parentMentions = await resolveMentionEntities(
          client,
          parentMentionIds,
        );

        let channelName = channelId;
        try {
          const convRes = await client.conversations.info({
            channel: channelId,
          });
          const ch = convRes.channel as { name?: string } | undefined;
          if (typeof ch?.name === "string" && ch.name.trim())
            channelName = ch.name.trim();
        } catch {
          // ignore
        }

        const chEntity = slackChannelEntity(channelId, channelName);
        parentSlackMessage = {
          messageTs: parent.ts,
          channel: chEntity,
          sender: { name: parentSenderName, id: parent.user ?? "" },
          text: parent.text ?? "",
          blocks: Array.isArray(parent.blocks) ? parent.blocks : [],
          attachments: parentRefs,
          mentions: parentMentions,
        };
      }
    } catch {
      // ignore
    }
  }

  const hasContent =
    effectiveText.length > 0 || attachments.length > 0 || blocksSummary != null;
  if (!hasContent) return null;

  let channelName = channelId;
  let senderName = "";
  let replyInThread = true;
  try {
    const [userRes, convRes] = await Promise.all([
      client.users.info({ user: userIdFromSlack }),
      client.conversations.info({ channel: channelId }),
    ]);
    senderName =
      (userRes.user as { real_name?: string })?.real_name ||
      (userRes.user as { name?: string })?.name ||
      userIdFromSlack;
    const ch = convRes.channel as {
      name?: string;
      is_im?: boolean;
      is_mpim?: boolean;
    };
    channelName = ch?.name ?? channelId;
    replyInThread = !(ch?.is_im || ch?.is_mpim);
  } catch {
    // fallback
  }

  const textForMentions = effectiveText || rawText;
  const mentionedIds = extractMentionedIds(textForMentions);
  const mentions = await resolveMentionEntities(client, mentionedIds);
  const chEntity = slackChannelEntity(channelId, channelName);

  const slackMessage: SlackMessageWithParent = {
    messageTs,
    channel: chEntity,
    sender: { name: senderName, id: userIdFromSlack },
    text: effectiveText,
    blocks: Array.isArray(blocks) ? blocks : [],
    attachments: attachmentRefs,
    mentions,
    parent: parentSlackMessage,
    replyInThread,
  };

  return {
    slackMessage,
    attachments,
    effectiveText,
    mentionedIds,
    ...(blocksSummary ? { blocksSummary } : {}),
  };
}

// --- Adapter ---

export interface SlackAdapterOptions {
  /** Called when agent identity (and optional profile) is resolved from Slack API so the worker can persist to config. */
  onAgentIdentityResolved?: (
    userId: string,
    profile?: SlackUserProfile,
  ) => void;
  /** Save downloaded files to attachment store; required for attachments to work. */
  attachmentService?: AttachmentService;
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
  const connectAs = config.connectAs ?? "bot";

  let agentIdentity = config.agentIdentity?.trim();
  let profile: SlackUserProfile | undefined = config.profile;

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
        id: userId,
        real_name: (u.real_name as string) || prof?.real_name || undefined,
        name: (u.name as string) || undefined,
        display_name: prof?.display_name || undefined,
      };
    } catch (e) {
      debug("users.info for agent profile failed: %o", e);
      return undefined;
    }
  }

  async function resolveIdentityFromSlack(): Promise<string | undefined> {
    try {
      const auth = await app.client.auth.test();
      let resolved =
        (auth as { user_id?: string }).user_id?.trim() ||
        (auth as { user?: string }).user?.trim() ||
        "";

      if (!resolved && connectAs === "bot") {
        const botId = (auth as { bot_id?: string }).bot_id?.trim();
        if (botId) {
          try {
            const botInfo = await app.client.bots.info({ bot: botId });
            resolved =
              (
                botInfo as {
                  bot?: { user_id?: string; id?: string };
                }
              ).bot?.user_id?.trim() || "";
          } catch (e) {
            debug("bots.info for bot identity failed: %o", e);
          }
        }
      }
      return resolved || undefined;
    } catch (e) {
      debug("auth.test failed, agentIdentity unknown: %o", e);
      return undefined;
    }
  }

  if (!agentIdentity || connectAs === "bot") {
    const resolved = await resolveIdentityFromSlack();
    if (resolved) agentIdentity = resolved;
  }

  if (agentIdentity) {
    profile = await fetchProfileForUser(agentIdentity);
    if (options?.onAgentIdentityResolved) {
      options.onAgentIdentityResolved(agentIdentity, profile);
    }
  }

  const token = config.userToken.trim();

  app.message(async ({ message, client }) => {
    if (
      message.subtype === "bot_message" ||
      (message as { bot_id?: string }).bot_id
    ) {
      debug(
        "Ignoring Slack message from bot (maybe self), not queuing: channel=%s",
        (message as { channel?: string }).channel,
      );
      return;
    }

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

    debug("Slack raw message event: %s", JSON.stringify(message, null, 2));

    const saveFiles = options?.attachmentService?.saveAll.bind(
      options.attachmentService,
    );
    const built = await createSlackMessageFromEvent(
      message as unknown as Record<string, unknown>,
      {
        token,
        client,
        saveFiles: saveFiles ?? (async () => []),
      },
    );
    if (!built) return;

    const {
      slackMessage,
      attachments: savedAttachments,
      effectiveText,
      blocksSummary,
    } = built;

    const userId = threadTs
      ? `slack:${channelId}:${threadTs}`
      : `slack:${channelId}`;

    const agentProfile: SlackChannelMeta["profile"] = {
      ...config.profile,
      ...profile,
      id: agentIdentity ?? config.profile?.id ?? "",
      connectAs: config.connectAs ?? config.profile?.connectAs ?? "bot",
    };

    const channelMeta: SlackChannelMeta = {
      channel: "slack",
      message: slackMessage,
      profile: agentProfile,
      connectAs: config.connectAs ?? "bot",
    };

    const payload: Record<string, unknown> = {
      text: effectiveText || (blocksSummary ?? ""),
      userId,
      channelMeta,
    };
    if (savedAttachments.length > 0) payload.attachments = savedAttachments;
    if (blocksSummary) payload.blocksSummary = blocksSummary;

    debug("Slack create message payload: %s", JSON.stringify(payload, null, 2));

    await dispatcher.dispatch(
      { source: "slack", type: "message.sent", payload },
      {},
    );
    debug(
      "Slack message.sent dispatched: channel=%s ts=%s (attachments=%d)",
      channelId,
      messageTs,
      savedAttachments.length,
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

export function isSlackAssistantStatusSupported(): boolean {
  return assistantStatusSupported;
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

/** Set Slack Assistant thread status label (bot-mode only). */
export async function setAssistantThreadStatus(
  channelId: string,
  threadTs: string,
  label: string,
): Promise<void> {
  if (!assistantStatusSupported) return;
  const app = slackApp;
  if (!app?.client) {
    throw new Error("Slack adapter not started or client unavailable");
  }
  try {
    await app.client.apiCall("assistant.threads.setStatus", {
      channel_id: channelId,
      thread_ts: threadTs,
      status: label,
    });
  } catch (err) {
    const data = (err as { data?: { error?: string } }).data;
    if (data?.error === "unknown_method") {
      assistantStatusSupported = false;
      debug(
        "Slack assistant.threads.setStatus unsupported for this app/token; disabling assistant status calls",
      );
      return;
    }
    throw err;
  }
}

// --- Slack meta (merged from slack-meta) ---

/** Slack `thread_ts` for the conversation (thread root if replying in thread, else this message). */
export function slackConversationThreadTs(meta: SlackChannelMeta): string {
  const m = meta.message;
  return m.parent ? m.parent.messageTs : m.messageTs;
}

/** `thread_ts` for posting assistant replies (undefined = channel message). */
export function slackReplyThreadTs(meta: SlackChannelMeta): string | undefined {
  const m = meta.message;
  if (m.parent) return m.parent.messageTs;
  if (m.replyInThread) return m.messageTs;
  return undefined;
}

export function slackDirectness(meta: SlackChannelMeta): "direct" | "neutral" {
  const pid = meta.profile.id;
  if (meta.message.channel.type === "dm") return "direct";
  if (pid && meta.message.text.includes(`<@${pid}>`)) return "direct";
  return "neutral";
}

export function slackDirectnessReason(meta: SlackChannelMeta): string {
  if (meta.message.channel.type === "dm") return "dm";
  if (slackDirectness(meta) === "direct") return "mention";
  return meta.message.channel.type === "group_chat"
    ? "group_message"
    : "channel_message";
}
