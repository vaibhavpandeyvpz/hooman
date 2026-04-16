import type { Model, BaseModelConfig } from "@strands-agents/sdk";

export type ModelProvider = {
  create: (
    model: string,
    params: Record<string, any>,
  ) => Model<BaseModelConfig>;
};

export const modelProviders: Record<string, () => Promise<ModelProvider>> = {
  anthropic: () => import("./anthropic.ts"),
  bedrock: () => import("./bedrock.ts"),
  google: () => import("./google.ts"),
  groq: () => import("./groq.ts"),
  ollama: () => import("./ollama/index.ts"),
  openai: () => import("./openai.ts"),
  xai: () => import("./xai.ts"),
};
