import { getChannelsConfig, updateChannelsConfig } from "../config.js";
import { setReloadFlags, type ReloadScope } from "../utils/reload-flag.js";
import { getRedis } from "../data/redis.js";
import { requestResponse } from "../utils/pubsub.js";
import type { ChannelsConfig } from "../types.js";
import type { WhatsAppConnection } from "./whatsapp-adapter.js";
import { mask, isMasked } from "../utils/helpers.js";
import { WebClient } from "@slack/web-api";

const WHATSAPP_CONNECTION_REQUEST_CHANNEL =
  "hooman:whatsapp:connection:request";
const WHATSAPP_CONNECTION_RESPONSE_CHANNEL =
  "hooman:whatsapp:connection:response";
const WHATSAPP_MCP_REQUEST_CHANNEL = "hooman:mcp:whatsapp:request";
const WHATSAPP_MCP_RESPONSE_CHANNEL = "hooman:mcp:whatsapp:response";
const WHATSAPP_CONNECTION_RPC_TIMEOUT_MS = 5000;
const WHATSAPP_MCP_RPC_TIMEOUT_MS = 15000;

export interface SlackConversationOption {
  id: string;
  name: string;
  type: "channel" | "private" | "dm" | "mpim" | "user";
}

export interface WhatsAppChatOption {
  id: string;
  name: string;
  isGroup: boolean;
}

export interface WhatsAppContactOption {
  id: string;
  name: string;
  number?: string;
}

export interface ChannelService {
  getChannels(): any;
  updateChannels(body: Partial<ChannelsConfig>): Promise<void>;
  getWhatsAppConnection(): Promise<
    WhatsAppConnection | { status: "disconnected" }
  >;
  logoutWhatsApp(): Promise<void>;
  getSlackConversations(): Promise<SlackConversationOption[]>;
  getWhatsAppChats(): Promise<WhatsAppChatOption[]>;
  getWhatsAppContacts(): Promise<WhatsAppContactOption[]>;
}

export function createChannelService(): ChannelService {
  return {
    getChannels() {
      const channels = getChannelsConfig();
      return {
        web: {
          id: "web",
          name: "Web chat",
          alwaysOn: true,
          config: null,
        },
        slack: channels.slack
          ? {
              id: "slack",
              name: "Slack",
              alwaysOn: false,
              enabled: channels.slack.enabled,
              config: {
                ...channels.slack,
                appToken: mask(channels.slack.appToken),
                userToken: mask(channels.slack.userToken),
              },
            }
          : {
              id: "slack",
              name: "Slack",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
        whatsapp: channels.whatsapp
          ? {
              id: "whatsapp",
              name: "WhatsApp",
              alwaysOn: false,
              enabled: channels.whatsapp.enabled,
              config: channels.whatsapp,
            }
          : {
              id: "whatsapp",
              name: "WhatsApp",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
      };
    },

    async updateChannels(body) {
      const current = getChannelsConfig();
      const patch: ChannelsConfig = { ...current };

      if (body.slack !== undefined) {
        const b = body.slack as ChannelsConfig["slack"];
        const c = current.slack;
        patch.slack = {
          ...c,
          ...b,
          appToken: isMasked(b?.appToken)
            ? (c?.appToken ?? b?.appToken)
            : b?.appToken,
          userToken: isMasked(b?.userToken)
            ? (c?.userToken ?? b?.userToken)
            : b?.userToken,
        } as ChannelsConfig["slack"];
      }

      if (body.whatsapp !== undefined) {
        patch.whatsapp = {
          ...current.whatsapp,
          ...body.whatsapp,
        } as ChannelsConfig["whatsapp"];
      }

      updateChannelsConfig(patch);

      const channelScopes: ReloadScope[] = [];
      if (body.slack !== undefined) channelScopes.push("slack");
      if (body.whatsapp !== undefined) channelScopes.push("whatsapp");

      if (channelScopes.length) {
        await setReloadFlags(channelScopes);
      }
    },

    async getWhatsAppConnection() {
      if (!getRedis()) {
        return { status: "disconnected" };
      }
      try {
        const result = (await requestResponse(
          WHATSAPP_CONNECTION_REQUEST_CHANNEL,
          WHATSAPP_CONNECTION_RESPONSE_CHANNEL,
          "get_connection_status",
          {},
          WHATSAPP_CONNECTION_RPC_TIMEOUT_MS,
        )) as WhatsAppConnection;
        return result;
      } catch {
        return { status: "disconnected" };
      }
    },

    async logoutWhatsApp() {
      if (!getRedis()) {
        throw new Error("Redis not initialized");
      }
      await requestResponse(
        WHATSAPP_CONNECTION_REQUEST_CHANNEL,
        WHATSAPP_CONNECTION_RESPONSE_CHANNEL,
        "logout",
        {},
        WHATSAPP_CONNECTION_RPC_TIMEOUT_MS,
      );
    },

    async getSlackConversations(): Promise<SlackConversationOption[]> {
      const slack = getChannelsConfig().slack;
      if (
        !slack?.enabled ||
        !slack.userToken?.trim() ||
        !slack.agentIdentity?.trim()
      ) {
        return [];
      }
      try {
        const client = new WebClient(slack.userToken.trim());

        // User cache (id -> display name) for DM/MPIM labels and Users tab
        const userCache = new Map<string, string>();
        let userCursor: string | undefined;
        do {
          const userResult = (await client.users.list({
            limit: 200,
            cursor: userCursor,
          })) as {
            members?: Array<{
              id: string;
              real_name?: string;
              name?: string;
              is_bot?: boolean;
              deleted?: boolean;
            }>;
            response_metadata?: { next_cursor?: string };
          };
          for (const u of userResult.members ?? []) {
            if (u.is_bot || u.deleted) continue;
            const label = (u.real_name || u.name || u.id).trim();
            if (label) userCache.set(u.id, label);
          }
          userCursor = userResult.response_metadata?.next_cursor;
        } while (userCursor);

        const types = "public_channel,private_channel,im,mpim";
        const raw: Array<{
          id: string;
          name?: string;
          is_im?: boolean;
          is_mpim?: boolean;
          is_private?: boolean;
        }> = [];
        let cursor: string | undefined;
        do {
          const result = (await client.conversations.list({
            types,
            limit: 200,
            exclude_archived: true,
            cursor,
          })) as {
            channels?: Array<{
              id: string;
              name?: string;
              is_channel?: boolean;
              is_private?: boolean;
              is_im?: boolean;
              is_mpim?: boolean;
            }>;
            response_metadata?: { next_cursor?: string };
          };
          raw.push(...(result.channels ?? []));
          cursor = result.response_metadata?.next_cursor;
        } while (cursor);

        const out: SlackConversationOption[] = [];
        const toEnrich = raw.filter((ch) => ch.is_im || ch.is_mpim);
        const agentId = slack.agentIdentity?.trim();
        const enriched = await Promise.all(
          toEnrich.map(async (ch) => {
            try {
              const info = (await client.conversations.info({
                channel: ch.id,
              })) as {
                channel?: { user?: string; members?: string[] };
              };
              const chan = info.channel;
              if (ch.is_im && chan?.user) {
                let name = userCache.get(chan.user);
                if (!name) {
                  try {
                    const u = (await client.users.info({
                      user: chan.user,
                    })) as {
                      user?: {
                        real_name?: string;
                        name?: string;
                        profile?: { real_name?: string; display_name?: string };
                      };
                    };
                    const uu = u.user;
                    name =
                      uu?.real_name ||
                      uu?.profile?.real_name ||
                      uu?.profile?.display_name ||
                      uu?.name ||
                      chan.user;
                  } catch {
                    name = chan.user;
                  }
                }
                return { id: ch.id, name };
              }
              if (ch.is_mpim) {
                let memberIds = chan?.members;
                if (!memberIds?.length) {
                  const memberList: string[] = [];
                  let memberCursor: string | undefined;
                  do {
                    const res = (await client.conversations.members({
                      channel: ch.id,
                      limit: 200,
                      cursor: memberCursor,
                    })) as {
                      members?: string[];
                      response_metadata?: { next_cursor?: string };
                    };
                    const page = res.members ?? [];
                    memberList.push(...page);
                    memberCursor = res.response_metadata?.next_cursor;
                  } while (memberCursor);
                  memberIds = memberList;
                }
                const members = agentId
                  ? memberIds.filter((m) => m !== agentId)
                  : memberIds;
                const names = members
                  .slice(0, 3)
                  .map((mid) => userCache.get(mid) || mid)
                  .filter(Boolean);
                const rest = members.length - names.length;
                return {
                  id: ch.id,
                  name:
                    names.length > 0
                      ? rest > 0
                        ? `${names.join(", ")} & ${rest} more`
                        : names.join(", ")
                      : `Group DM (${ch.id})`,
                };
              }
            } catch {
              //
            }
            return { id: ch.id, name: ch.name || ch.id };
          }),
        );
        const enrichMap = new Map(
          toEnrich.map((ch, i) => [ch.id, enriched[i]!]),
        );

        for (const ch of raw) {
          const type: SlackConversationOption["type"] = ch.is_im
            ? "dm"
            : ch.is_mpim
              ? "mpim"
              : ch.is_private
                ? "private"
                : "channel";
          const resolved = ch.is_im || ch.is_mpim ? enrichMap.get(ch.id) : null;
          const name = resolved ? resolved.name : (ch.name ?? ch.id);
          out.push({ id: ch.id, name, type });
        }

        // Add workspace users so filter can target DMs or mentions by user ID
        for (const [uid, label] of userCache) {
          if (uid === slack.agentIdentity?.trim()) continue;
          out.push({ id: uid, name: label, type: "user" });
        }
        return out;
      } catch {
        return [];
      }
    },

    async getWhatsAppChats(): Promise<WhatsAppChatOption[]> {
      if (!getRedis()) return [];
      try {
        const result = (await requestResponse(
          WHATSAPP_MCP_REQUEST_CHANNEL,
          WHATSAPP_MCP_RESPONSE_CHANNEL,
          "chats_list",
          {},
          WHATSAPP_MCP_RPC_TIMEOUT_MS,
        )) as {
          chats?: Array<{ id: string; name?: string; isGroup?: boolean }>;
        };
        const chats = result.chats ?? [];
        return chats.map((c) => ({
          id: c.id,
          name: c.name ?? c.id,
          isGroup: !!c.isGroup,
        }));
      } catch {
        return [];
      }
    },

    async getWhatsAppContacts(): Promise<WhatsAppContactOption[]> {
      if (!getRedis()) return [];
      try {
        const result = (await requestResponse(
          WHATSAPP_MCP_REQUEST_CHANNEL,
          WHATSAPP_MCP_RESPONSE_CHANNEL,
          "contacts_list",
          {},
          WHATSAPP_MCP_RPC_TIMEOUT_MS,
        )) as {
          contacts?: Array<{ id: string; name?: string; number?: string }>;
        };
        const contacts = result.contacts ?? [];
        return contacts.map((c) => ({
          id: c.id,
          name: (c.name || c.number || c.id).trim(),
          number: c.number,
        }));
      } catch {
        return [];
      }
    },
  };
}
