import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";

/** Config JSON / provider params for chat OpenAI (`api` and `modelId` are set by {@link create}). */
export type OpenAIModelParams = Omit<OpenAIModelOptions, "api" | "modelId">;

export function create(
  model: string,
  params: Record<string, unknown>,
): OpenAIModel {
  return new OpenAIModel({
    api: "chat",
    modelId: model,
    ...(params as OpenAIModelParams),
  });
}
