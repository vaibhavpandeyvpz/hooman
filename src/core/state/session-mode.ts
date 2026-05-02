import { z } from "zod";

export const MODE_STATE_KEY = "mode";

export const SessionModeSchema = z.enum(["default", "plan"]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

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

function normalizeMode(value: unknown): SessionMode {
  const parsed = SessionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "default";
}

export function getModeState(agent: AgentLike): ModeState {
  const mode = normalizeMode(agent.appState.get(MODE_STATE_KEY));
  return { mode };
}

export function setSessionMode(agent: AgentLike, mode: SessionMode): void {
  agent.appState.set(MODE_STATE_KEY, mode);
}

export function clearModeToDefault(agent: AgentLike): void {
  agent.appState.set(MODE_STATE_KEY, "default");
}
