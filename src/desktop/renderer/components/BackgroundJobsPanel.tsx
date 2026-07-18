import type { ShellJobInfo } from "../../shared/session-types.js";
import { Square, TerminalSquare } from "lucide-react";

/** Lists the active session's running/queued background shell jobs, with a Stop action for each. */
export function BackgroundJobsPanel({
  jobs,
  onStop,
}: {
  jobs: ShellJobInfo[];
  onStop: (jobId: string) => void;
}) {
  return (
    <div className="flex h-1/2 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-[12.5px]">
        <TerminalSquare size={13} className="text-hooman-muted" />
        <span className="font-medium">Background</span>
        <span className="text-hooman-muted">{jobs.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-1">
        {jobs.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-hooman-muted">
            No background processes running.
          </p>
        ) : (
          <div className="space-y-0.5">
            {jobs.map((job) => (
              <div
                key={job.jobId}
                className="group flex items-center gap-1.5 rounded-md px-1 py-1 text-[12.5px] hover:bg-slate-800"
              >
                <span
                  className="min-w-0 flex-1 truncate"
                  title={job.description}
                >
                  {job.description}
                </span>
                <span className="shrink-0 text-[10.5px] text-hooman-muted">
                  {job.stopping ? "stopping…" : job.status}
                </span>
                <button
                  type="button"
                  title="Stop"
                  disabled={job.stopping}
                  className="shrink-0 rounded-md p-1 text-hooman-muted hover:bg-slate-800 hover:text-hooman-error disabled:opacity-50"
                  onClick={() => onStop(job.jobId)}
                >
                  <Square size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
