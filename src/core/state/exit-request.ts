export const EXIT_REQUESTED_STATE_KEY = "exitRequested";
export const EXIT_REQUESTED_CODE = 3010;

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
  delete(key: string): void;
};

type AgentLike = {
  appState: AppStateLike;
};

export function requestExit(agent: AgentLike): void {
  agent.appState.set(EXIT_REQUESTED_STATE_KEY, true);
}

export function isExitRequested(agent: AgentLike): boolean {
  return agent.appState.get(EXIT_REQUESTED_STATE_KEY) === true;
}

export function consumeExitRequest(agent: AgentLike): boolean {
  const requested = isExitRequested(agent);
  if (requested) {
    agent.appState.delete(EXIT_REQUESTED_STATE_KEY);
  }
  return requested;
}
