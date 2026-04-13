import { GoogleModel } from "@strands-agents/sdk/models/google";
import type { GoogleModelOptions } from "@strands-agents/sdk/models/google";
import { omit, pick } from "lodash";

/**
 * Keys passed to {@link GoogleModel} alongside `modelId` / `params`.
 * Generation options (`temperature`, `maxOutputTokens`, …) belong in `params`
 * (see Gemini [GenerationConfig](https://ai.google.dev/api/generate-content#generationconfig)).
 */
const TOP_LEVEL_KEYS = [
  "apiKey",
  "client",
  "clientConfig",
  "builtInTools",
] as const;

function omitUndefined(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const unset = Object.keys(record).filter((k) => record[k] === undefined);
  return omit(record, unset);
}

/**
 * Google Gemini via Strands {@link GoogleModel} (`@google/genai` under the hood).
 *
 * - **`config.llm.model`**: Gemini id (e.g. `gemini-2.5-flash`).
 * - **`params`**: Optional `apiKey` (defaults to `GEMINI_API_KEY`), or `client` / `clientConfig`
 *   for a custom Google GenAI client. Any other keys are sent as `params` to the API
 *   (`temperature`, `maxOutputTokens`, `topP`, `topK`, …).
 */
export function create(
  model: string,
  params: Record<string, unknown> = {},
): GoogleModel {
  const top = omitUndefined(
    pick(params, [...TOP_LEVEL_KEYS]) as Record<string, unknown>,
  ) as Pick<
    GoogleModelOptions,
    "apiKey" | "client" | "clientConfig" | "builtInTools"
  >;
  const filtered = omitUndefined(
    omit(params, [...TOP_LEVEL_KEYS]) as Record<string, unknown>,
  );

  return new GoogleModel({
    modelId: model,
    ...top,
    ...(Object.keys(filtered).length > 0 ? { params: filtered } : {}),
  } as GoogleModelOptions);
}
