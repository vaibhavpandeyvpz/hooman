/**
 * Strands appState key holding the AI-generated session title. Persisted with
 * the session snapshot (`data.state`) by both the SDK `SessionManager` and
 * `LazySessionManager`, so the title travels with the conversation history.
 * Set by the session-title plugin (see `src/core/agent/session-title-plugin.ts`).
 */
export const TITLE_STATE_KEY = "hooman.title";

type AppStateLike = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

export function getSessionTitle(agent: AgentLike): string | null {
  const value = agent.appState.get(TITLE_STATE_KEY);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function setSessionTitle(agent: AgentLike, title: string): void {
  agent.appState.set(TITLE_STATE_KEY, title);
}
