import type {
  ChannelMeta,
  SlackChannelMeta,
  WhatsAppChannelMeta,
} from "../types.js";
import { slackDirectness, slackDirectnessReason } from "./slack-adapter.js";
import {
  whatsAppDirectness,
  whatsAppDirectnessReason,
  whatsAppDestinationType,
  whatsAppSelfMentioned,
} from "./whatsapp-adapter.js";
import { applyFilter as applyFilterImpl } from "./filter.js";

/**
 * Build a human-readable channel context string from channelMeta so the agent knows where the message came from and can reply using channel MCP tools.
 * Appends `message` (SlackMessageWithParent / WhatsAppMessage) as JSON for the agent.
 */
export function buildChannelContext(
  meta: ChannelMeta | undefined,
): string | undefined {
  if (!meta) return undefined;
  const lines: string[] = [`source_channel: ${meta.channel}`];
  if (meta.channel === "whatsapp") {
    const w = meta as WhatsAppChannelMeta;
    const m = w.message;
    lines.push(`chatId: ${m.chat.id}`);
    lines.push(`messageId: ${m.id}`);
    lines.push(`destinationType: ${whatsAppDestinationType(w)}`);
    if (m.sender.name) lines.push(`senderName: ${m.sender.name}`);
    if (whatsAppSelfMentioned(w)) lines.push(`selfMentioned: true`);
  } else if (meta.channel === "slack") {
    const s = meta as SlackChannelMeta;
    const m = s.message;
    lines.push(`channelId: ${m.channel.id}`);
    lines.push(`messageTs: ${m.messageTs}`);
    if (m.parent) lines.push(`threadTs: ${m.parent.messageTs}`);
    lines.push(`destinationType: ${m.channel.type}`);
    lines.push(`senderId: ${m.sender.id}`);
    if (m.sender.name) lines.push(`senderName: ${m.sender.name}`);
    if (s.connectAs) lines.push(`connectedAs: ${s.connectAs}`);
    if (s.profile.id) lines.push(`yourSlackUserId: ${s.profile.id}`);
    const prof = s.profile;
    if (prof.real_name || prof.name || prof.display_name) {
      lines.push(
        "yourSlackUserNames: " +
          [prof.real_name, prof.name, prof.display_name]
            .filter(Boolean)
            .join(", "),
      );
    }
    if (s.profile.id && m.mentions.some((x) => x.id === s.profile.id)) {
      lines.push(`selfMentioned: true`);
    }
  }
  if (meta.channel === "slack") {
    const s = meta as SlackChannelMeta;
    lines.push(`directness: ${slackDirectness(s)}`);
    lines.push(`directnessReason: ${slackDirectnessReason(s)}`);
  } else {
    const w = meta as WhatsAppChannelMeta;
    lines.push(`directness: ${whatsAppDirectness(w)}`);
    lines.push(`directnessReason: ${whatsAppDirectnessReason(w)}`);
  }

  if (meta.channel === "slack") {
    lines.push("");
    lines.push("Structured message (SlackMessageWithParent):");
    lines.push(JSON.stringify((meta as SlackChannelMeta).message, null, 2));
  }
  if (meta.channel === "whatsapp") {
    lines.push("");
    lines.push("Structured message (WhatsAppMessage):");
    lines.push(JSON.stringify((meta as WhatsAppChannelMeta).message, null, 2));
  }

  return lines.join("\n");
}

/** Re-export for callers that import from shared. */
export const applyFilter = applyFilterImpl;
