import type {
  ChatHistoryStore,
  GetMessagesResult,
} from "../data/chat-history.js";

export interface ContextStore {
  /** Persist one user/assistant turn to chat history only (UI). Call only for api-source chat. */
  addTurn(
    userId: string,
    userText: string,
    assistantText: string,
    userAttachments?: string[],
  ): Promise<void>;
  /** Last N messages in chronological order for agent thread. */
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
  /** Paginated messages for GET /api/chat/history. */
  getMessages(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<GetMessagesResult>;
  /** Clear all messages for the user. */
  clearAll(userId: string): Promise<void>;
}

export function createContext(chatHistory: ChatHistoryStore): ContextStore {
  return {
    async addTurn(
      userId: string,
      userText: string,
      assistantText: string,
      userAttachments?: string[],
    ): Promise<void> {
      await chatHistory.addMessage(userId, "user", userText, userAttachments);
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
    },
  };
}
