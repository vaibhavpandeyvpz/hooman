import OpenAI from "openai";

const CHAT_STREAM_USAGE_PATCH_KEY = Symbol.for(
  "hooman.openaiChatCompletionsUsageStreamPatch",
);

/**
 * Wrap `client.chat.completions.create` so streaming responses split usage onto an empty
 * `choices` chunk when needed (see {@link splitUsageOntoEmptyChoicesChunk}). Idempotent per
 * client instance.
 */
export function patchOpenAIClientChatCompletionsForUsage(client: OpenAI): void {
  const marked = client as unknown as {
    [CHAT_STREAM_USAGE_PATCH_KEY]?: boolean;
  };
  if (marked[CHAT_STREAM_USAGE_PATCH_KEY]) {
    return;
  }
  marked[CHAT_STREAM_USAGE_PATCH_KEY] = true;

  const completions = client.chat.completions;
  const originalCreate = completions.create.bind(completions);
  completions.create = (async (
    body: Parameters<typeof originalCreate>[0],
    options?: Parameters<typeof originalCreate>[1],
  ) => {
    const result = await originalCreate(body, options);
    if (
      body &&
      typeof body === "object" &&
      "stream" in body &&
      body.stream === true
    ) {
      const asStream = result as unknown;
      if (
        asStream != null &&
        typeof (
          asStream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
        )[Symbol.asyncIterator] === "function"
      ) {
        return splitUsageOntoEmptyChoicesChunk(
          asStream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
        );
      }
    }
    return result;
  }) as unknown as typeof completions.create;
}

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
