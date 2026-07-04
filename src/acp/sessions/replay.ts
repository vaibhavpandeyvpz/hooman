import {
  type AgentContext,
  type ContentBlock as AcpContentBlock,
  type SessionNotification,
  methods,
} from "@agentclientprotocol/sdk";
import type { Message } from "@strands-agents/sdk";
import {
  ToolResultBlock,
  ToolUseBlock,
  type ContentBlock,
} from "@strands-agents/sdk";
import { inferToolKind } from "../utils/tool-kind.js";
import { toolResultToAcpContent } from "../utils/tool-result-content.js";

const IMAGE_MIME_BY_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  png: "image/png",
};

const VIDEO_MIME_BY_FORMAT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  flv: "video/x-flv",
  wmv: "video/x-ms-wmv",
  "3gp": "video/3gpp",
};

const DOCUMENT_MIME_BY_FORMAT: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  html: "text/html",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  txt: "text/plain",
};

function attachmentUri(name: string, context?: string): string {
  if (context && /^[a-z][a-z0-9+.-]*:\/\//i.test(context)) {
    return context;
  }
  return `attachment:///${encodeURIComponent(name)}`;
}

/**
 * Map a persisted Strands media block back to its standard ACP content block
 * — the inverse of the `session/prompt` ingestion in `prompt-invoke.ts`, so
 * replayed user messages carry the same block types the client originally
 * sent (`image`, embedded blob `resource`). How to render them (pills,
 * thumbnails, ...) is the client's concern. Returns null for non-media
 * blocks and sources without inline bytes.
 */
function mediaBlockToAcpContent(block: ContentBlock): AcpContentBlock | null {
  if (block.type === "imageBlock") {
    if (block.source.type !== "imageSourceBytes") {
      return null;
    }
    return {
      type: "image",
      data: Buffer.from(block.source.bytes).toString("base64"),
      mimeType: IMAGE_MIME_BY_FORMAT[block.format] ?? "image/png",
    };
  }
  if (block.type === "videoBlock") {
    if (block.source.type !== "videoSourceBytes") {
      return null;
    }
    const name = `video.${block.format}`;
    return {
      type: "resource",
      resource: {
        uri: attachmentUri(name),
        blob: Buffer.from(block.source.bytes).toString("base64"),
        mimeType: VIDEO_MIME_BY_FORMAT[block.format] ?? "video/mp4",
      },
    };
  }
  if (block.type === "documentBlock") {
    const mimeType = DOCUMENT_MIME_BY_FORMAT[block.format] ?? "text/plain";
    const uri = attachmentUri(block.name, block.context);
    if (block.source.type === "documentSourceBytes") {
      return {
        type: "resource",
        resource: {
          uri,
          blob: Buffer.from(block.source.bytes).toString("base64"),
          mimeType,
        },
      };
    }
    if (block.source.type === "documentSourceText") {
      return {
        type: "resource",
        resource: { uri, text: block.source.text, mimeType },
      };
    }
    return null;
  }
  return null;
}

function blockToFallbackText(block: ContentBlock): string | null {
  if (block.type === "textBlock") {
    return block.text;
  }
  // Prompt-caching markers are internal bookkeeping, not conversation content.
  if (block.type === "cachePointBlock") {
    return null;
  }
  try {
    return JSON.stringify(block.toJSON?.() ?? block, null, 2);
  } catch {
    return String(block);
  }
}

function collectToolResults(messages: Message[]): Map<string, ToolResultBlock> {
  const byId = new Map<string, ToolResultBlock>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block instanceof ToolResultBlock) {
        byId.set(block.toolUseId, block);
      }
    }
  }
  return byId;
}

/**
 * Replay persisted conversation to the client using ACP session updates.
 * Emits separate chunks for text vs structured tool call / result updates.
 */
export async function replayConversationHistory(
  client: AgentContext,
  sessionId: string,
  messages: Message[],
): Promise<void> {
  const send = (update: SessionNotification["update"]) =>
    client.notify(methods.client.session.update, { sessionId, update });

  const resultsByToolUseId = collectToolResults(messages);

  for (const message of messages) {
    const role = message.role;
    // One `messageId` per persisted message, shared by all chunks derived
    // from it (see the `MessageId` RFD: a change in `messageId` indicates a
    // new message has started).
    const messageId = crypto.randomUUID();

    for (const block of message.content) {
      if (role === "user") {
        if (block instanceof ToolResultBlock) {
          await send({
            sessionUpdate: "tool_call_update",
            toolCallId: block.toolUseId,
            status: block.status === "success" ? "completed" : "failed",
            rawOutput: block.toJSON() as unknown,
            content: toolResultToAcpContent(block),
          });
          continue;
        }
        const media = mediaBlockToAcpContent(block);
        if (media) {
          await send({
            sessionUpdate: "user_message_chunk",
            content: media,
            messageId,
          });
          continue;
        }
        const text = blockToFallbackText(block);
        if (text?.trim()) {
          await send({
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text },
            messageId,
          });
        }
        continue;
      }

      if (role === "assistant") {
        if (block instanceof ToolUseBlock) {
          const hasResult = resultsByToolUseId.has(block.toolUseId);
          await send({
            sessionUpdate: "tool_call",
            toolCallId: block.toolUseId,
            title: block.name,
            kind: inferToolKind(block.name),
            rawInput: block.input,
            status: hasResult ? "in_progress" : "completed",
          });
          continue;
        }
        if (block.type === "textBlock") {
          const t = block.text;
          if (t) {
            await send({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: t },
              messageId,
            });
          }
          continue;
        }
        if (block.type === "reasoningBlock") {
          // Only the reasoning text belongs in the transcript — never the
          // signature / redacted payload the block also carries.
          const t = block.text;
          if (t?.trim()) {
            await send({
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: t },
              messageId,
            });
          }
          continue;
        }
        const fallback = blockToFallbackText(block);
        if (fallback?.trim()) {
          await send({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: fallback },
            messageId,
          });
        }
      }
    }
  }
}
