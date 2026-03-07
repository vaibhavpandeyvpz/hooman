#!/usr/bin/env node
/**
 * WhatsApp MCP server (stdio). Exposes WhatsApp operations as MCP tools. Communicates with the
 * WhatsApp worker over Redis pub/sub (no direct WhatsApp connection). Set REDIS_URL when running.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initRedis, waitForRedis } from "../../data/redis.js";
import { createRequestResponse } from "../../utils/pubsub.js";
import { env } from "../../env.js";

const REQUEST_CHANNEL = "hooman:mcp:whatsapp:request";
const RESPONSE_CHANNEL = "hooman:mcp:whatsapp:response";
const RPC_TIMEOUT_MS = 25_000;

const redisUrl = env.REDIS_URL;
if (!redisUrl) {
  process.exit(1);
}

initRedis(redisUrl);
await waitForRedis();

const rpc = createRequestResponse(
  REQUEST_CHANNEL,
  RESPONSE_CHANNEL,
  RPC_TIMEOUT_MS,
);

function textContent(text: string): { type: "text"; text: string }[] {
  return [{ type: "text" as const, text }];
}

const server = new McpServer(
  { name: "hooman-whatsapp", version: "1.0.0" },
  { capabilities: {} },
);

server.registerTool(
  "whatsapp_chats_list",
  {
    title: "List WhatsApp chats",
    description: "List all chats (DMs and groups) the user has.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = await rpc("chats_list", {});
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_chat_info",
  {
    title: "Get WhatsApp chat info",
    description:
      "Get details for a chat by ID (e.g. 1234567890@c.us or group id). For groups, includes participants.",
    inputSchema: z.object({
      chatId: z
        .string()
        .describe("Chat ID (e.g. 1234567890@c.us or group JID)"),
    }),
  },
  async (args) => {
    const result = await rpc("chat_info", { chatId: args?.chatId });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_contacts_list",
  {
    title: "List WhatsApp contacts",
    description: "List all contacts from the user's address book.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = await rpc("contacts_list", {});
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_contact_info",
  {
    title: "Get WhatsApp contact info",
    description: "Get details for a contact by ID (e.g. 1234567890@c.us).",
    inputSchema: z.object({
      contactId: z.string().describe("Contact ID (e.g. 1234567890@c.us)"),
    }),
  },
  async (args) => {
    const result = await rpc("contact_info", { contactId: args?.contactId });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_chat_participants",
  {
    title: "List group participants",
    description:
      "List participants in a group chat. Returns empty for non-group chats.",
    inputSchema: z.object({ chatId: z.string().describe("Group chat ID") }),
  },
  async (args) => {
    const result = await rpc("chat_participants", { chatId: args?.chatId });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_send_message",
  {
    title: "Send a WhatsApp message",
    description: "Send a text message to a chat (DM or group).",
    inputSchema: z.object({
      chatId: z
        .string()
        .describe("Chat ID (e.g. 1234567890@c.us or group JID)"),
      text: z.string().describe("Message text"),
    }),
  },
  async (args) => {
    try {
      const result = await rpc("send_message", {
        chatId: args?.chatId,
        text: args?.text,
      });
      return { content: textContent(JSON.stringify(result, null, 2)) };
    } catch (err) {
      throw err;
    }
  },
);

server.registerTool(
  "whatsapp_send_media",
  {
    title: "Send media (image, document, voice, etc.)",
    description:
      "Send a file to a chat. data is base64-encoded content; mimetype is required (e.g. image/png, application/pdf).",
    inputSchema: z.object({
      chatId: z.string(),
      data: z.string().describe("Base64-encoded file content"),
      mimetype: z
        .string()
        .describe("MIME type (e.g. image/png, application/pdf, audio/ogg)"),
      filename: z.string().optional(),
      caption: z.string().optional(),
    }),
  },
  async (args) => {
    const result = await rpc("send_media", {
      chatId: args?.chatId,
      data: args?.data,
      mimetype: args?.mimetype,
      filename: args?.filename,
      caption: args?.caption,
    });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_reply_to_message",
  {
    title: "Reply to a message",
    description:
      "Send a reply to an existing message (quoted reply). Optionally specify chatId if replying in a different chat.",
    inputSchema: z.object({
      messageId: z.string().describe("ID of the message to reply to"),
      text: z.string().describe("Reply text"),
      chatId: z
        .string()
        .optional()
        .describe("Chat ID (optional; usually inferred from message)"),
    }),
  },
  async (args) => {
    const result = await rpc("reply_to_message", {
      messageId: args?.messageId,
      text: args?.text,
      chatId: args?.chatId,
    });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_get_chat_messages",
  {
    title: "Get recent messages in a chat",
    description:
      "Fetch recent messages in a chat for context before replying. Returns id, body, from, timestamp, fromMe, type.",
    inputSchema: z.object({
      chatId: z.string().describe("Chat ID (DM or group)"),
      limit: z
        .number()
        .optional()
        .describe("Max messages to return (default 50, max 100)"),
    }),
  },
  async (args) => {
    const result = await rpc("get_chat_messages", {
      chatId: args?.chatId,
      limit: args?.limit,
    });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_react_to_message",
  {
    title: "React to a message with emoji",
    description:
      "Add an emoji reaction to a message (e.g. 👍, ❤️, 😂). Use for quick acknowledgment.",
    inputSchema: z.object({
      messageId: z.string().describe("ID of the message to react to"),
      emoji: z.string().optional().describe("Emoji (default: 👍)"),
    }),
  },
  async (args) => {
    const result = await rpc("react_to_message", {
      messageId: args?.messageId,
      emoji: args?.emoji,
    });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_send_typing",
  {
    title: "Show typing indicator",
    description:
      "Show 'typing...' in the chat for ~25 seconds. Use before sending a longer reply so the user sees you're responding.",
    inputSchema: z.object({
      chatId: z.string().describe("Chat ID to show typing in"),
    }),
  },
  async (args) => {
    const result = await rpc("send_typing", { chatId: args?.chatId });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_create_group",
  {
    title: "Create a WhatsApp group",
    description:
      "Create a new group with a title and optional list of participant contact IDs (e.g. 1234567890@c.us). Returns the new group ID and title.",
    inputSchema: z.object({
      title: z.string().describe("Group name"),
      participantIds: z
        .array(z.string())
        .optional()
        .describe(
          'Contact IDs to add as participants (e.g. ["1234567890@c.us"])',
        ),
    }),
  },
  async (args) => {
    const result = await rpc("create_group", {
      title: args?.title,
      participantIds: args?.participantIds ?? [],
    });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_get_common_groups",
  {
    title: "Get common groups with a contact",
    description:
      "Get all group IDs that you and the given contact are both in. Returns empty array if none.",
    inputSchema: z.object({
      contactId: z.string().describe("Contact ID (e.g. 1234567890@c.us)"),
    }),
  },
  async (args) => {
    const result = await rpc("get_common_groups", {
      contactId: args?.contactId,
    });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_get_profile_pic_url",
  {
    title: "Get profile picture URL",
    description:
      "Get the profile picture URL for a contact or chat. Returns null if not available (e.g. privacy settings).",
    inputSchema: z.object({
      contactId: z
        .string()
        .describe("Contact or chat ID (e.g. 1234567890@c.us or group JID)"),
    }),
  },
  async (args) => {
    const result = await rpc("get_profile_pic_url", {
      contactId: args?.contactId,
    });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

server.registerTool(
  "whatsapp_set_status",
  {
    title: "Set WhatsApp status",
    description:
      "Set the current user's WhatsApp status message (the text shown as 'About' / status).",
    inputSchema: z.object({
      status: z.string().describe("New status message"),
    }),
  },
  async (args) => {
    const result = await rpc("set_status", { status: args?.status ?? "" });
    return { content: textContent(JSON.stringify(result, null, 2)) };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
