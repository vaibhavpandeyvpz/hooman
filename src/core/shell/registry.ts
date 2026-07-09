import { ShellJobManager } from "./manager.js";

/** Keyed by the Strands agent instance so managers are never serialized. */
const managers = new WeakMap<object, ShellJobManager>();

export function getShellJobManager(agent: object): ShellJobManager {
  let manager = managers.get(agent);
  if (!manager) {
    manager = new ShellJobManager(agent);
    managers.set(agent, manager);
  }
  return manager;
}

export function peekShellJobManager(
  agent: object | undefined,
): ShellJobManager | undefined {
  return agent ? managers.get(agent) : undefined;
}

/** Stop all jobs and drop the manager for this agent (session teardown). */
export async function clearShellJobManager(agent: object): Promise<void> {
  const manager = managers.get(agent);
  if (!manager) {
    return;
  }
  await manager.clear();
  managers.delete(agent);
}
