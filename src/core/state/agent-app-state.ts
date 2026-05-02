import type { Agent } from "@strands-agents/sdk";

/**
 * Copies every entry from `from.appState` onto `to.appState` (via Strands `getAll` / `set`).
 * Use after recreating an agent so plan mode, yolo, session allowlists, todos, etc. survive.
 */
export function copyAgentAppState(from: Agent, to: Agent): void {
  const data = from.appState.getAll();
  for (const key of Object.keys(data)) {
    to.appState.set(key, data[key]!);
  }
}
