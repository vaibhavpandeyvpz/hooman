import type { ChannelMeta, FilterMode, SlackChannelMeta } from "../types.js";

/**
 * Build a human-readable channel context string from channelMeta so the agent knows where the message came from and can reply using channel MCP tools.
 */
export function buildChannelContext(
  meta: ChannelMeta | undefined,
): string | undefined {
  if (!meta) return undefined;
  const lines: string[] = [`source_channel: ${meta.channel}`];
  if (meta.channel === "whatsapp") {
    lines.push(`chatId: ${meta.chatId}`);
    lines.push(`messageId: ${meta.messageId}`);
    lines.push(`destinationType: ${meta.destinationType}`);
    if (meta.pushName) lines.push(`senderName: ${meta.pushName}`);
    if (meta.selfMentioned) lines.push(`selfMentioned: true`);
  } else if (meta.channel === "slack") {
    lines.push(`channelId: ${meta.channelId}`);
    lines.push(`messageTs: ${meta.messageTs}`);
    if (meta.threadTs) lines.push(`threadTs: ${meta.threadTs}`);
    lines.push(`destinationType: ${meta.destinationType}`);
    lines.push(`senderId: ${meta.senderId}`);
    if (meta.senderName) lines.push(`senderName: ${meta.senderName}`);
    if (meta.yourSlackUserId)
      lines.push(`yourSlackUserId: ${meta.yourSlackUserId}`);
    const slackMeta = meta as SlackChannelMeta;
    const prof = slackMeta.yourSlackUserProfile;
    if (prof && (prof.real_name || prof.name || prof.display_name)) {
      lines.push(
        "yourSlackUserNames: " +
          [prof.real_name, prof.name, prof.display_name]
            .filter(Boolean)
            .join(", "),
      );
    }
    if (meta.selfMentioned) lines.push(`selfMentioned: true`);
  }
  lines.push(`directness: ${meta.directness}`);
  if (meta.directnessReason)
    lines.push(`directnessReason: ${meta.directnessReason}`);
  return lines.join("\n");
}

/**
 * Generic channel filter: returns true if the message should be processed.
 * Each adapter provides a channel-specific `matchFn` that checks whether
 * a normalised filter-list entry matches the current message context.
 */
export function applyFilter(
  config: { filterMode?: FilterMode; filterList?: string[] },
  matchFn: (entry: string) => boolean,
): boolean {
  const mode = config.filterMode ?? "all";
  if (mode === "all") return true;
  const list = (config.filterList ?? []).map((x) => x.trim());
  const match = list.some(matchFn);
  return mode === "allowlist" ? match : !match;
}
