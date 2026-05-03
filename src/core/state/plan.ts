export const PLAN_FILE_STATE_KEY = "hooman.planFile";
export const PLAN_ENTER_REASON_STATE_KEY = "hooman.enterReason";
export const PLAN_ENTERED_AT_STATE_KEY = "hooman.enteredAt";

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

export type PlanState = {
  planFile: string | null;
  enterReason: string | null;
  enteredAt: string | null;
};

export function getPlanState(agent: AgentLike): PlanState {
  const rawPlanFile = agent.appState.get(PLAN_FILE_STATE_KEY);
  const planFile =
    typeof rawPlanFile === "string" && rawPlanFile.trim()
      ? rawPlanFile.trim()
      : null;
  const rawEnterReason = agent.appState.get(PLAN_ENTER_REASON_STATE_KEY);
  const enterReason =
    typeof rawEnterReason === "string" && rawEnterReason.trim()
      ? rawEnterReason.trim()
      : null;
  const rawEnteredAt = agent.appState.get(PLAN_ENTERED_AT_STATE_KEY);
  const enteredAt =
    typeof rawEnteredAt === "string" && rawEnteredAt.trim()
      ? rawEnteredAt.trim()
      : null;
  return { planFile, enterReason, enteredAt };
}

export function setPlanState(
  agent: AgentLike,
  snapshot: {
    planFile: string;
    enterReason?: string | undefined;
    enteredAt: string;
  },
): void {
  agent.appState.set(PLAN_FILE_STATE_KEY, snapshot.planFile);
  if (snapshot.enterReason?.trim()) {
    agent.appState.set(
      PLAN_ENTER_REASON_STATE_KEY,
      snapshot.enterReason.trim(),
    );
  } else {
    agent.appState.set(PLAN_ENTER_REASON_STATE_KEY, null);
  }
  agent.appState.set(PLAN_ENTERED_AT_STATE_KEY, snapshot.enteredAt);
}

export function clearPlanState(agent: AgentLike): void {
  agent.appState.set(PLAN_FILE_STATE_KEY, null);
  agent.appState.set(PLAN_ENTER_REASON_STATE_KEY, null);
  agent.appState.set(PLAN_ENTERED_AT_STATE_KEY, null);
}
