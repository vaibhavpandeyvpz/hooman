import type { Message } from "@strands-agents/sdk";
import type OpenAI from "openai";

/**
 * Kimi + tool calls with thinking on still needs a non-empty thought when we have no session
 * replay text; direct OpenAI wire uses `reasoning_content`, TensorZero uses thought blocks.
 */
export const MOONSHOT_REASONING_PLACEHOLDER = " ";

/**
 * Strands’ adapter merges `reasoningBlock` into `content`; strip those blocks before
 * `formatChatRequest`, then replay via {@link collectReasoningTextPerWireAssistant} and
 * {@link applyKimiReasoningContentToChatRequest} or TensorZero’s `tensorzero_extra_content`.
 */
export function stripAssistantReasoningBlocks(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") {
      return msg;
    }
    return {
      ...msg,
      content: msg.content.filter((b) => b.type !== "reasoningBlock"),
    } as Message;
  });
}

/**
 * One entry per Strands assistant turn that survives Strands’ OpenAI formatter (non-empty
 * visible text and/or at least one tool use). Order matches `assistant` rows in
 * `formatChatMessages` output.
 *
 * **Carry-over:** Strands may emit a reasoning-only assistant `Message` (no text, no tools).
 * That row is dropped on the wire after stripping reasoning; pending text is merged into the
 * next wire assistant’s replay slot.
 */
export function collectReasoningTextPerWireAssistant(
  messages: Message[],
): string[] {
  const out: string[] = [];
  const pendingReasoning: string[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant") {
      continue;
    }
    const reasoningParts: string[] = [];
    const textParts: string[] = [];
    let toolUseCount = 0;
    for (const block of msg.content) {
      if (block.type === "reasoningBlock") {
        if (block.text) {
          reasoningParts.push(block.text);
        }
      } else if (block.type === "textBlock") {
        textParts.push(block.text);
      } else if (block.type === "toolUseBlock") {
        toolUseCount += 1;
      }
    }
    const reasoningJoined = reasoningParts.join("\n");
    const textContent = textParts.join("").trim();
    const producesWireAssistant = textContent.length > 0 || toolUseCount > 0;

    if (!producesWireAssistant) {
      if (reasoningJoined.length > 0) {
        pendingReasoning.push(reasoningJoined);
      }
      continue;
    }

    const combined = [...pendingReasoning, reasoningJoined]
      .filter((s) => s.length > 0)
      .join("\n");
    pendingReasoning.length = 0;
    out.push(combined);
  }

  return out;
}

type AssistantWireReasoningContent =
  OpenAI.Chat.ChatCompletionAssistantMessageParam & {
    reasoning_content?: string | null;
  };

export type KimiReasoningWireApplyOptions = {
  /**
   * Moonshot/Kimi with thinking: tool-only assistant rows still need a non-empty
   * `reasoning_content`. Leave `false` for official OpenAI (default) so requests are unchanged.
   */
  toolPlaceholderWhenMissingReasoning?: boolean;
};

/**
 * Direct Moonshot / Kimi OpenAI API (e.g. via Bifrost): when thinking is on, assistant rows
 * with `tool_calls` must include non-empty `reasoning_content`. Strands stores thinking in
 * `reasoningBlock`; strip those before `formatChatRequest`, collect via
 * {@link collectReasoningTextPerWireAssistant}, then call this.
 *
 * For **api.openai.com**, omit this call or pass default options: no replay and no placeholder
 * means the request body is not mutated.
 */
export function applyKimiReasoningContentToChatRequest(
  request: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  reasoningPerWireAssistant: readonly string[],
  options?: KimiReasoningWireApplyOptions,
): void {
  const placeholderTools =
    options?.toolPlaceholderWhenMissingReasoning === true;
  const anyReplay = reasoningPerWireAssistant.some((s) => s.trim().length > 0);
  if (!anyReplay && !placeholderTools) {
    return;
  }

  let assistantOrdinal = 0;
  for (const msg of request.messages) {
    if (msg.role !== "assistant") {
      continue;
    }
    const extended = msg as AssistantWireReasoningContent;
    const existing = extended.reasoning_content;
    if (typeof existing === "string" && existing.length > 0) {
      assistantOrdinal += 1;
      continue;
    }

    const raw = reasoningPerWireAssistant[assistantOrdinal] ?? "";
    assistantOrdinal += 1;

    const hasReplay = raw.trim().length > 0;
    const hasTools = !!extended.tool_calls && extended.tool_calls.length > 0;

    if (hasReplay) {
      extended.reasoning_content = raw;
    } else if (hasTools && placeholderTools) {
      extended.reasoning_content = MOONSHOT_REASONING_PLACEHOLDER;
    }
  }
}
