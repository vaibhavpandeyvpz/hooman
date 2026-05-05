import type OpenAI from "openai";

/**
 * Some OpenAI-compatible gateways (e.g. TensorZero) attach `usage` to the final chunk that
 * still has non-empty `choices`. Strands' chat mapper only reads `usage` when `choices` is
 * empty. Split so usage appears on an empty-choices chunk first.
 */
export async function* splitUsageOntoEmptyChoicesChunk(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  for await (const chunk of stream) {
    const usage = chunk.usage;
    const choices = chunk.choices;
    if (usage && choices && choices.length > 0) {
      yield { ...chunk, choices: [] };
      yield { ...chunk, usage: undefined };
    } else {
      yield chunk;
    }
  }
}
