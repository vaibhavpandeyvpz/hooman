import type { ShellJobInfo, ShellJobStatus } from "../shell/types.js";
import { peekShellJobManager } from "../shell/registry.js";

export type ShellJobViewState = {
  visible: boolean;
  jobs: ShellJobInfo[];
  active: number;
};

const ACTIVE: ReadonlySet<ShellJobStatus> = new Set([
  "starting",
  "running",
  "ready",
]);

type AgentLike = object;

export function getShellJobViewState(agent: AgentLike): ShellJobViewState {
  const manager = peekShellJobManager(agent);
  if (!manager) {
    return { visible: false, jobs: [], active: 0 };
  }
  const jobs = manager.list();
  const activeJobs = jobs.filter((j) => ACTIVE.has(j.status));
  return {
    visible: activeJobs.length > 0,
    jobs: activeJobs,
    active: activeJobs.length,
  };
}
