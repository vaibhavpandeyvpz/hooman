import { getPrisma } from "./db.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface GetMessagesResult {
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    attachments?: string[];
    createdAt: Date;
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
    attachments?: string[],
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
      attachments?: string[];
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
      attachments?: string[],
    ) {
      await prisma.chatMessage.create({
        data: {
          userId,
          role,
          text,
          ...(attachments?.length
            ? { attachments: JSON.stringify(attachments) }
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
          select: {
            role: true,
            text: true,
            attachments: true,
            createdAt: true,
          },
        }),
        prisma.chatMessage.count({ where: { userId } }),
      ]);

      const messages = rows.map((r) => ({
        role: r.role as "user" | "assistant",
        text: r.text,
        attachments: parseAttachmentIds(r.attachments),
        createdAt: r.createdAt,
      }));

      return { messages, total, page, pageSize };
    },

    async getRecentMessages(userId: string, limit: number) {
      const n = Math.min(100, Math.max(1, limit));
      const rows = await prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: n,
        select: { role: true, text: true, attachments: true, createdAt: true },
      });

      return rows.reverse().map((r) => ({
        role: r.role as "user" | "assistant",
        text: r.text,
        attachments: parseAttachmentIds(r.attachments),
        createdAt: r.createdAt,
      }));
    },

    async clearAll(userId: string) {
      await prisma.chatMessage.deleteMany({ where: { userId } });
    },
  };
}
