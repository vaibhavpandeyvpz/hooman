import { DEFAULT_SESSION_MODE, type SessionMode } from "../modes/schema.js";

export const MODE_STATE_KEY = "mode";
export type { SessionMode } from "../modes/schema.js";

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

export type ModeState = {
  mode: SessionMode;
};

export function getModeState(agent: AgentLike): ModeState {
  const mode = agent.appState.get(MODE_STATE_KEY) ?? DEFAULT_SESSION_MODE;
  return { mode: mode as string };
}

export function setSessionMode(agent: AgentLike, mode: SessionMode): void {
  agent.appState.set(MODE_STATE_KEY, mode);
}

export function clearModeToDefault(agent: AgentLike): void {
  agent.appState.set(MODE_STATE_KEY, DEFAULT_SESSION_MODE);
}
