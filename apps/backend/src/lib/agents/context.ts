import type { IMemoryService } from "../data/memory.js";
import type {
  ChatHistoryStore,
  GetMessagesResult,
} from "../data/chat-history.js";
import type { MemorySearchResult } from "../data/memory.js";

export interface ContextStore {
  /** Add messages to Mem0 only (no chat history). Use for all events so agents can recall them. */
  addToMemory(
    messages: Array<{ role: string; content: string }>,
    options?: { userId?: string; metadata?: Record<string, unknown> },
  ): Promise<void>;
  /** Persist one user/assistant turn to chat history only (UI). Call only for api-source chat. */
  addTurn(
    userId: string,
    userText: string,
    assistantText: string,
    userAttachmentIds?: string[],
  ): Promise<void>;
  /** Last N messages in chronological order for agent thread. */
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
  /** Paginated messages for GET /api/chat/history. */
  getMessages(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<GetMessagesResult>;
  /** Clear all messages and memory for the user. */
  clearAll(userId: string): Promise<void>;
  /** Semantic search over memory for agent context. */
  search(
    query: string,
    options?: { userId?: string; limit?: number },
  ): Promise<MemorySearchResult[]>;
}

export function createContext(
  memory: IMemoryService,
  chatHistory: ChatHistoryStore,
): ContextStore {
  return {
    async addToMemory(
      messages: Array<{ role: string; content: string }>,
      options?: { userId?: string; metadata?: Record<string, unknown> },
    ): Promise<void> {
      const userId = options?.userId ?? "default";
      const createdAt = new Date().toISOString();
      for (let i = 0; i < messages.length; i++) {
        await memory.add([messages[i]], {
          userId,
          metadata: { ...options?.metadata, createdAt, messageIndex: i },
        });
      }
    },

    async addTurn(
      userId: string,
      userText: string,
      assistantText: string,
      userAttachmentIds?: string[],
    ): Promise<void> {
      await chatHistory.addMessage(userId, "user", userText, userAttachmentIds);
      await chatHistory.addMessage(userId, "assistant", assistantText);
    },

    async getRecentMessages(
      userId: string,
      limit: number,
    ): Promise<Array<{ role: "user" | "assistant"; text: string }>> {
      return chatHistory.getRecentMessages(userId, limit);
    },

    async getMessages(
      userId: string,
      options?: { page?: number; pageSize?: number },
    ): Promise<GetMessagesResult> {
      return chatHistory.getMessages(userId, options);
    },

    async clearAll(userId: string): Promise<void> {
      await chatHistory.clearAll(userId);
      await memory.deleteAll({ userId });
    },

    async search(
      query: string,
      options?: { userId?: string; limit?: number },
    ): Promise<MemorySearchResult[]> {
      return memory.search(query, {
        userId: options?.userId ?? "default",
        limit: options?.limit ?? 10,
      });
    },
  };
}
