import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import OpenAI from "openai";
import { patchOpenAIClientChatCompletionsForUsage } from "./openai-stream-shims.js";

/** Config JSON / provider params for chat OpenAI (`api` and `modelId` are set by {@link create}). */
export type OpenAIModelParams = Omit<OpenAIModelOptions, "api" | "modelId">;

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
  patchOpenAIClientChatCompletionsForUsage(client);
  return openaiModel;
}
