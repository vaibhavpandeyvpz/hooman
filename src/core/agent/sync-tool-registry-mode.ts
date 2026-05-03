import { clearPlanState } from "../state/plan.js";
import { getModeState } from "../state/session-mode.js";
import { ModeAwareToolRegistry } from "./mode-aware-tool-registry.js";

type SyncAgent = Parameters<typeof getModeState>[0] & {
  toolRegistry: unknown;
};

export function applySessionMode(agent: SyncAgent): void {
  const registry = agent.toolRegistry;
  if (!(registry instanceof ModeAwareToolRegistry)) {
    return;
  }
  const { mode } = getModeState(agent);
  registry.setSessionMode(mode);
  if (mode !== "plan") {
    clearPlanState(agent);
  }
}
