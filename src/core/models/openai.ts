import { OpenAIModel } from "@strands-agents/sdk/models/openai";

export function create(
  model: string,
  params: { apiKey?: string },
): OpenAIModel {
  return new OpenAIModel({
    api: "chat",
    modelId: model,
    ...params,
  });
}
