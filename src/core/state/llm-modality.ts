import type { ResolvedLlmInputModality } from "../utils/model-metadata.js";

/** Strands appState key for the active LLM's resolved input modalities. */
export const LLM_MODALITY_STATE_KEY = "hooman.llmModality";

type AppStateLike = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

function isModality(value: unknown): value is ResolvedLlmInputModality {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { text?: unknown }).text === "boolean"
  );
}

export function getLlmModality(
  agent: AgentLike | undefined,
): ResolvedLlmInputModality | null {
  if (!agent) {
    return null;
  }
  const raw = agent.appState.get(LLM_MODALITY_STATE_KEY);
  return isModality(raw) ? raw : null;
}

export function setLlmModality(
  agent: AgentLike,
  modality: ResolvedLlmInputModality | null | undefined,
): void {
  agent.appState.set(LLM_MODALITY_STATE_KEY, modality ?? null);
}
