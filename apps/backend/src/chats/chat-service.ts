import { randomUUID } from "crypto";
import type { ChatHistoryStore, GetMessagesResult } from "./chat-history.js";
import type { AttachmentService } from "../attachments/attachment-service.js";
import type { RawDispatchInput } from "../types.js";
import type { ContextStore } from "../agents/context.js";

export interface ChatService {
  getHistory(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<
    GetMessagesResult & {
      messages: Array<{
        role: "user" | "assistant";
        text: string;
        attachments?: string[];
        attachment_metas?: Array<{
          id: string;
          originalName: string;
          mimeType: string;
        }>;
        timestamp?: string;
      }>;
    }
  >;
  clearHistory(userId: string): Promise<void>;
  sendMessage(
    userId: string,
    text: string,
    attachmentIds?: string[],
    enqueue?: (
      raw: RawDispatchInput,
      options?: { correlationId?: string },
    ) => Promise<string>,
  ): Promise<string>;
}

export function createChatService(
  historyStore: ChatHistoryStore,
  attachmentService: AttachmentService,
  context: ContextStore,
): ChatService {
  return {
    async getHistory(userId, options) {
      const result = await historyStore.getMessages(userId, options);
      const messagesWithMeta = await Promise.all(
        result.messages.map(async (m) => {
          const ids = m.attachments ?? [];
          const timestamp =
            m.createdAt instanceof Date ? m.createdAt.toISOString() : undefined;

          if (ids.length === 0) {
            return {
              role: m.role,
              text: m.text,
              attachments: m.attachments,
              ...(timestamp != null ? { timestamp } : {}),
            };
          }

          const attachment_metas = await Promise.all(
            ids.map(async (id) => {
              const doc = await attachmentService.getAttachmentDoc(id, userId);
              return doc
                ? { id, originalName: doc.originalName, mimeType: doc.mimeType }
                : null;
            }),
          );

          return {
            role: m.role,
            text: m.text,
            attachments: m.attachments,
            attachment_metas: attachment_metas.filter(
              (
                a,
              ): a is { id: string; originalName: string; mimeType: string } =>
                a !== null,
            ),
            ...(timestamp != null ? { timestamp } : {}),
          };
        }),
      );

      return {
        ...result,
        messages: messagesWithMeta,
      } as any;
    },

    async clearHistory(userId) {
      return context.clearAll(userId);
    },

    async sendMessage(userId, text, attachmentIds, enqueue) {
      if (!enqueue) throw new Error("Enqueue function not provided");

      let attachmentContents:
        | Array<{ name: string; contentType: string; data: string }>
        | undefined;

      if (attachmentIds?.length) {
        attachmentContents = await attachmentService.resolveAttachments(
          attachmentIds,
          userId,
        );
      }

      const eventId = randomUUID();
      await enqueue(
        {
          source: "api",
          type: "message.sent",
          payload: {
            text,
            userId,
            ...(attachmentContents?.length ? { attachmentContents } : {}),
            ...(attachmentIds?.length ? { attachments: attachmentIds } : {}),
          },
        },
        { correlationId: eventId },
      );

      return eventId;
    },
  };
}
