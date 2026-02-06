import { getPrisma } from "./db.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface GetMessagesResult {
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    attachment_ids?: string[];
  }>;
  total: number;
  page: number;
  pageSize: number;
}

export interface ChatHistoryStore {
  addMessage(
    userId: string,
    role: "user" | "assistant",
    text: string,
    attachment_ids?: string[],
  ): Promise<void>;
  getMessages(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<GetMessagesResult>;
  getRecentMessages(
    userId: string,
    limit: number,
  ): Promise<
    Array<{
      role: "user" | "assistant";
      text: string;
      attachment_ids?: string[];
    }>
  >;
  clearAll(userId: string): Promise<void>;
}

function parseAttachmentIds(raw: string | null): string[] | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map(String) : undefined;
  } catch {
    return undefined;
  }
}

export async function initChatHistory(): Promise<ChatHistoryStore> {
  const prisma = getPrisma();

  return {
    async addMessage(
      userId: string,
      role: "user" | "assistant",
      text: string,
      attachment_ids?: string[],
    ) {
      await prisma.chatMessage.create({
        data: {
          userId,
          role,
          text,
          ...(attachment_ids?.length
            ? {
                attachment_ids: JSON.stringify(attachment_ids),
              }
            : {}),
        },
      });
    },

    async getMessages(
      userId: string,
      options?: { page?: number; pageSize?: number },
    ) {
      const page = Math.max(1, options?.page ?? 1);
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE),
      );
      const skip = (page - 1) * pageSize;

      const [rows, total] = await Promise.all([
        prisma.chatMessage.findMany({
          where: { userId },
          orderBy: { createdAt: "asc" },
          skip,
          take: pageSize,
          select: { role: true, text: true, attachment_ids: true },
        }),
        prisma.chatMessage.count({ where: { userId } }),
      ]);

      const messages = rows.map((r) => ({
        role: r.role as "user" | "assistant",
        text: r.text,
        attachment_ids: parseAttachmentIds(r.attachment_ids),
      }));

      return { messages, total, page, pageSize };
    },

    async getRecentMessages(userId: string, limit: number) {
      const n = Math.min(100, Math.max(1, limit));
      const rows = await prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: n,
        select: { role: true, text: true, attachment_ids: true },
      });

      return rows.reverse().map((r) => ({
        role: r.role as "user" | "assistant",
        text: r.text,
        attachment_ids: parseAttachmentIds(r.attachment_ids),
      }));
    },

    async clearAll(userId: string) {
      await prisma.chatMessage.deleteMany({ where: { userId } });
    },
  };
}
