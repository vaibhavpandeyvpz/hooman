import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import { StrandsTensorZeroModel } from "./strands-tensorzero.js";

export { StrandsTensorZeroModel } from "./strands-tensorzero.js";

export type TensorZeroModelConfig = Omit<OpenAIModelOptions, "api" | "modelId">;

/**
 * Strands {@link Model} for a TensorZero gateway’s OpenAI-compatible HTTP API (`/openai/v1`).
 * Handles gateway-specific streaming: token usage on the last chunk and `tensorzero_extra_content` thoughts.
 *
 * Set TensorZero tags (e.g. `user_id` for gateway rate limits) in config under `llm.params.params`:
 * `"params": { "tensorzero::tags": { "user_id": "…" } }` alongside `apiKey` / `clientConfig`.
 */
export function create(
  model: string,
  params: Record<string, unknown>,
): StrandsTensorZeroModel {
  return new StrandsTensorZeroModel({
    api: "chat",
    modelId: model,
    ...(params as TensorZeroModelConfig),
  });
}
