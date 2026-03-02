import { join } from "path";
import { generateText } from "ai";
import {
  MemoryLayer,
  createSQLiteStorageAdapter,
  type SummaryRequest,
} from "@one710/recollect";
import type { RecollectMessage } from "@one710/recollect";
import type { ModelMessage } from "ai";
import type { ChatHistoryStore } from "./chat-history.js";
import { getConfig } from "../config.js";
import { getHoomanModel } from "../agents/model-provider.js";
import { WORKSPACE_ROOT } from "../utils/workspace.js";

export interface ContextStore {
  /** Persist one user/assistant turn to chat history only (for UI). Use with addTurnToAgentThread when storing full AI SDK messages in memory. */
  addTurnToChatHistory(
    userId: string,
    userText: string,
    assistantText: string,
    userAttachments?: string[],
  ): Promise<void>;
  /** Persist a full turn as AI SDK messages (includes tool calls, tool results, etc.). Use when available. Call addTurnToChatHistory too so the UI has the turn. */
  addTurnToAgentThread(userId: string, messages: ModelMessage[]): Promise<void>;
  /** Token-limited thread for the agent (from recollect; full AI SDK messages when stored with addTurnToAgentThread). */
  getThreadForAgent(userId: string): Promise<ModelMessage[]>;
  /** Clear all messages for the user (chat history and recollect). */
  clearAll(userId: string): Promise<void>;
}

function toRecollectMessage(msg: ModelMessage): RecollectMessage {
  const role = msg.role as RecollectMessage["role"];
  if (typeof msg.content === "string") {
    return { role, content: msg.content };
  }
  if (Array.isArray(msg.content)) {
    const parts = (msg.content as unknown[]).map((p: unknown) => {
      const q = p as Record<string, unknown>;
      if (!q || typeof q !== "object") return { type: "text", text: String(p) };
      const t = String(q.type ?? "unknown").toLowerCase();
      if (t === "text" && "text" in q) return { type: "text", text: q.text };
      if (t === "tool-call" || t === "tool_call") {
        return {
          type: "tool-call" as const,
          toolCallId: (q.toolCallId ?? q.tool_call_id ?? "") as string,
          toolName: (q.toolName ?? q.name ?? "") as string,
          input: q.input ?? q.args,
        };
      }
      if (t === "tool-result" || t === "tool_result") {
        return {
          type: "tool-result" as const,
          toolCallId: (q.toolCallId ?? q.tool_call_id ?? "") as string,
          toolName: (q.toolName ?? q.name ?? "") as string,
          output: q.output ?? q.result,
        };
      }
      return q as RecollectMessage["content"] extends (infer P)[] ? P : never;
    });
    return { role, content: parts };
  }
  return { role, content: String(msg.content ?? "") };
}

function toModelMessage(msg: RecollectMessage): ModelMessage {
  return { ...msg } as ModelMessage;
}

async function createMemoryLayer(): Promise<MemoryLayer> {
  const config = getConfig();
  const maxTokens = config.MAX_INPUT_TOKENS || 100_000;
  const model = getHoomanModel(config);

  const summarize = async (input: SummaryRequest): Promise<string> => {
    const { text } = await generateText({
      model,
      system: input.instructions,
      prompt: input.summaryPrompt,
    });
    return text ?? "";
  };

  const storage = await createSQLiteStorageAdapter(
    join(WORKSPACE_ROOT, "context.db"),
  );

  return new MemoryLayer({
    maxTokens,
    summarize,
    threshold: 0.75,
    storage,
  });
}

export async function createContext(
  chatHistory: ChatHistoryStore,
): Promise<ContextStore> {
  const memory = await createMemoryLayer();

  return {
    async addTurnToChatHistory(
      userId: string,
      userText: string,
      assistantText: string,
      userAttachments?: string[],
    ): Promise<void> {
      await chatHistory.addMessage(userId, "user", userText, userAttachments);
      await chatHistory.addMessage(userId, "assistant", assistantText);
    },

    async addTurnToAgentThread(
      userId: string,
      messages: ModelMessage[],
    ): Promise<void> {
      for (const msg of messages) {
        await memory.addMessage(userId, null, toRecollectMessage(msg));
      }
    },

    async getThreadForAgent(userId: string): Promise<ModelMessage[]> {
      const messages = await memory.getMessages(userId);
      return messages.map((msg) => {
        const m = toModelMessage(msg);
        if (m.role === "system") {
          return { ...m, role: "user" as const };
        }
        if (
          m.role === "assistant" &&
          (m.content == null ||
            (Array.isArray(m.content) && m.content.length === 0))
        ) {
          return { ...m, content: "(empty)" };
        }
        return m;
      });
    },

    async clearAll(userId: string): Promise<void> {
      await chatHistory.clearAll(userId);
      await memory.clearSession(userId);
    },
  };
}
