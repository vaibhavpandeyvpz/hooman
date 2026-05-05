import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import OpenAI from "openai";
import { splitUsageOntoEmptyChoicesChunk } from "./openai-stream-shims.js";

/** Config JSON / provider params for chat OpenAI (`api` and `modelId` are set by {@link create}). */
export type OpenAIModelParams = Omit<OpenAIModelOptions, "api" | "modelId">;

const STREAM_PATCH_KEY = Symbol.for(
  "hooman.openaiChatCompletionsUsageStreamPatch",
);

function patchChatCompletionsStream(client: OpenAI): void {
  const marked = client as unknown as { [STREAM_PATCH_KEY]?: boolean };
  if (marked[STREAM_PATCH_KEY]) {
    return;
  }
  marked[STREAM_PATCH_KEY] = true;

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

export function create(
  model: string,
  params: Record<string, unknown>,
): OpenAIModel {
  const openaiModel = new OpenAIModel({
    api: "chat",
    modelId: model,
    ...(params as OpenAIModelParams),
  });
  const client = (openaiModel as unknown as { _client: OpenAI })._client;
  patchChatCompletionsStream(client);
  return openaiModel;
}
