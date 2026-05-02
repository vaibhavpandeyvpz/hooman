import { z } from "zod";

export const PLAN_MODE_STATE_KEY = "plan.mode";
export const PLAN_FILE_STATE_KEY = "plan.planFile";
export const PLAN_ENTER_REASON_STATE_KEY = "plan.enterReason";
export const PLAN_ENTERED_AT_STATE_KEY = "plan.enteredAt";

export const PlanSessionModeSchema = z.enum(["plan", "default"]);
export type PlanSessionMode = z.infer<typeof PlanSessionModeSchema>;

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

export type PlanModeState = {
  mode: PlanSessionMode;
  planFile: string | null;
  enterReason: string | null;
  enteredAt: string | null;
};

function normalizeMode(value: unknown): PlanSessionMode {
  const parsed = PlanSessionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "default";
}

export function getPlanModeState(agent: AgentLike): PlanModeState {
  const mode = normalizeMode(agent.appState.get(PLAN_MODE_STATE_KEY));
  const rawFile = agent.appState.get(PLAN_FILE_STATE_KEY);
  const planFile =
    typeof rawFile === "string" && rawFile.trim() ? rawFile.trim() : null;
  const rawReason = agent.appState.get(PLAN_ENTER_REASON_STATE_KEY);
  const enterReason =
    typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : null;
  const rawAt = agent.appState.get(PLAN_ENTERED_AT_STATE_KEY);
  const enteredAt =
    typeof rawAt === "string" && rawAt.trim() ? rawAt.trim() : null;
  return { mode, planFile, enterReason, enteredAt };
}

export function setPlanSessionPlanning(
  agent: AgentLike,
  snapshot: {
    planFile: string;
    enterReason?: string | undefined;
    enteredAt: string;
  },
): void {
  agent.appState.set(PLAN_MODE_STATE_KEY, "plan");
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

export function clearPlanModeToDefault(agent: AgentLike): void {
  agent.appState.set(PLAN_MODE_STATE_KEY, "default");
  agent.appState.set(PLAN_FILE_STATE_KEY, null);
  agent.appState.set(PLAN_ENTER_REASON_STATE_KEY, null);
  agent.appState.set(PLAN_ENTERED_AT_STATE_KEY, null);
}
