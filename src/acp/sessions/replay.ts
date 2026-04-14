import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { Message } from "@strands-agents/sdk";
import {
  ToolResultBlock,
  ToolUseBlock,
  type ContentBlock,
} from "@strands-agents/sdk";
import { inferToolKind } from "../utils/tool-kind.ts";
import { toolResultToAcpContent } from "../utils/tool-result-content.ts";

function blockToFallbackText(block: ContentBlock): string | null {
  if (block.type === "textBlock") {
    return block.text;
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
  connection: AgentSideConnection,
  sessionId: string,
  messages: Message[],
): Promise<void> {
  const resultsByToolUseId = collectToolResults(messages);

  for (const message of messages) {
    const role = message.role;

    for (const block of message.content) {
      if (role === "user") {
        if (block instanceof ToolResultBlock) {
          await connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: block.toolUseId,
              status: block.status === "success" ? "completed" : "failed",
              rawOutput: block.toJSON() as unknown,
              content: toolResultToAcpContent(block),
            },
          });
          continue;
        }
        const text = blockToFallbackText(block);
        if (text?.trim()) {
          await connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text },
            },
          });
        }
        continue;
      }

      if (role === "assistant") {
        if (block instanceof ToolUseBlock) {
          const hasResult = resultsByToolUseId.has(block.toolUseId);
          await connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: block.toolUseId,
              title: block.name,
              kind: inferToolKind(block.name),
              rawInput: block.input,
              status: hasResult ? "in_progress" : "completed",
            },
          });
          continue;
        }
        if (block.type === "textBlock") {
          const t = block.text;
          if (t) {
            await connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: t },
              },
            });
          }
          continue;
        }
        if (block.type === "reasoningBlock") {
          const t = blockToFallbackText(block);
          if (t?.trim()) {
            await connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: t },
              },
            });
          }
          continue;
        }
        const fallback = blockToFallbackText(block);
        if (fallback?.trim()) {
          await connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: fallback },
            },
          });
        }
      }
    }
  }
}
