import type { Message } from "@strands-agents/sdk";
import type OpenAI from "openai";

/**
 * Kimi + tool calls with thinking on still needs a non-empty thought when we have no session
 * replay text; TensorZero carries that as {@link TensorZeroExtraThoughtBlock}, not Moonshot’s
 * raw `reasoning_content` field.
 */
const MOONSHOT_REASONING_PLACEHOLDER = " ";

/**
 * TensorZero’s OpenAI-compat assistant struct has `content`, `tool_calls`, and
 * `tensorzero_extra_content` — it does **not** deserialize `reasoning_content`, so that field
 * never reaches Moonshot. Replay chain-of-thought as `tensorzero_extra_content` entries with
 * `type: "thought"` (see TensorZero `openai_messages_to_input` / `ExtraContentBlock::Thought`).
 *
 * Strands’ adapter merges `reasoningBlock` into `content`; we strip those blocks before
 * `formatChatRequest`, collect their text per wire assistant row, then attach thoughts here.
 */

/** Shallow copy: assistant `content` without `reasoningBlock` (other roles unchanged). */
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

/**
 * TensorZero OpenAI-compat thought block (serde `ExtraContentBlock::Thought` with flattened
 * `Thought` fields).
 */
export type TensorZeroExtraThoughtBlock = {
  type: "thought";
  /** Insert before text + tool calls in the internal assistant message (`0` = first). */
  insert_index: number;
  text: string;
};

type AssistantWire = OpenAI.Chat.ChatCompletionAssistantMessageParam & {
  tensorzero_extra_content?: TensorZeroExtraThoughtBlock[];
};

/**
 * Replay session reasoning through TensorZero so Moonshot receives `Thought` content, not
 * dropped `reasoning_content`. Skips rows that already set `tensorzero_extra_content`.
 */
export function applyKimiReasoningReplayToChatRequest(
  request: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  reasoningPerWireAssistant: readonly string[],
): void {
  let assistantOrdinal = 0;
  for (const msg of request.messages) {
    if (msg.role !== "assistant") {
      continue;
    }
    const extended = msg as AssistantWire;
    if (
      extended.tensorzero_extra_content &&
      extended.tensorzero_extra_content.length > 0
    ) {
      assistantOrdinal += 1;
      continue;
    }

    const raw = reasoningPerWireAssistant[assistantOrdinal] ?? "";
    assistantOrdinal += 1;

    const hasReplay = raw.trim().length > 0;
    const hasTools = !!extended.tool_calls && extended.tool_calls.length > 0;

    let thoughtText: string | null = null;
    if (hasReplay) {
      thoughtText = raw;
    } else if (hasTools) {
      thoughtText = MOONSHOT_REASONING_PLACEHOLDER;
    }

    if (thoughtText !== null) {
      extended.tensorzero_extra_content = [
        { type: "thought", insert_index: 0, text: thoughtText },
      ];
    }
  }
}
