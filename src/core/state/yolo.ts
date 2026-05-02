/** Strands appState key; matches ACP session option id {@link HOOMAN_YOLO_CONFIG_ID}. */
export const YOLO_STATE_KEY = "hooman.yolo";

type AppStateLike = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

export function isYoloEnabled(agent: AgentLike): boolean {
  return agent.appState.get(YOLO_STATE_KEY) === true;
}

export function setYoloEnabled(agent: AgentLike, enabled: boolean): void {
  agent.appState.set(YOLO_STATE_KEY, enabled);
}
