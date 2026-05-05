import type OpenAI from "openai";
import { MOONSHOT_REASONING_PLACEHOLDER } from "../openai/kimi-reasoning-wire.js";

/**
 * TensorZero’s OpenAI-compat assistant struct has `content`, `tool_calls`, and
 * `tensorzero_extra_content` — it does **not** deserialize `reasoning_content`, so that field
 * never reaches Moonshot. Replay chain-of-thought as `tensorzero_extra_content` entries with
 * `type: "thought"` (see TensorZero `openai_messages_to_input` / `ExtraContentBlock::Thought`).
 *
 * Shared Strands → wire helpers: `openai/kimi-reasoning-wire.ts`.
 */

export {
  collectReasoningTextPerWireAssistant,
  stripAssistantReasoningBlocks,
} from "../openai/kimi-reasoning-wire.js";

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
