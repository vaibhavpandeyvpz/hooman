import type { TranscriptState } from "../../shared/session-types.js";
import { BackgroundJobsPanel } from "./BackgroundJobsPanel.js";
import { ChangesPanel } from "./ChangesPanel.js";

/** Right-hand rail: pending file changes and running background shell jobs for the active session. */
export function RightPanel({
  state,
  onStopShellJob,
  onKeepEdit,
  onUndoEdit,
  onKeepAllEdits,
  onUndoAllEdits,
}: {
  state: TranscriptState;
  onStopShellJob: (jobId: string) => void;
  onKeepEdit: (path: string) => void;
  onUndoEdit: (path: string) => void;
  onKeepAllEdits: () => void;
  onUndoAllEdits: () => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-slate-800">
      <ChangesPanel
        state={state}
        onKeep={onKeepEdit}
        onUndo={onUndoEdit}
        onKeepAll={onKeepAllEdits}
        onUndoAll={onUndoAllEdits}
      />
      <BackgroundJobsPanel jobs={state.shellJobs} onStop={onStopShellJob} />
    </aside>
  );
}
