import { useState } from "react";
import {
  selectPendingEdits,
  type TranscriptState,
} from "../../shared/session-reducer.js";
import { Check, FileDiff, RotateCcw } from "lucide-react";
import { baseName, computeDiffLines } from "../lib/diff.js";
import { DiffCard } from "./DiffCard.js";

/**
 * Aggregates every pending file diff in this session into a "Changes"
 * summary (mirrors the VS Code webview's `EditsPanel.tsx`): each file can be
 * kept or reverted individually, or all at once, in addition to expanding
 * an inline diff.
 */
export function ChangesPanel({
  state,
  onKeep,
  onUndo,
  onKeepAll,
  onUndoAll,
}: {
  state: TranscriptState;
  onKeep: (path: string) => void;
  onUndo: (path: string) => void;
  onKeepAll: () => void;
  onUndoAll: () => void;
}) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const files = selectPendingEdits(state);

  return (
    <div className="flex h-1/2 flex-col overflow-hidden border-b border-slate-800">
      <div className="flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-[12.5px]">
        <FileDiff size={13} className="text-hooman-muted" />
        <span className="font-medium">Changes</span>
        <span className="text-hooman-muted">{files.length}</span>
        {files.length > 0 && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              title="Undo all changes"
              className="rounded-md px-1.5 py-0.5 text-[11px] text-hooman-muted hover:bg-slate-800 hover:text-slate-100"
              onClick={onUndoAll}
            >
              Undo all
            </button>
            <button
              type="button"
              title="Keep all changes"
              className="rounded-md bg-hooman-primary px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-hooman-primary/90"
              onClick={onKeepAll}
            >
              Keep all
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-1">
        {files.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-hooman-muted">
            No changes yet.
          </p>
        ) : (
          files.map(({ path, oldText, newText }) => {
            const { adds, removes } = computeDiffLines(oldText, newText);
            const isExpanded = expandedPath === path;
            const created = oldText === null;
            return (
              <div key={path}>
                <div className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] hover:bg-slate-800">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    onClick={() => setExpandedPath(isExpanded ? null : path)}
                    title={path}
                  >
                    {baseName(path)}
                    {created && (
                      <span className="text-hooman-muted"> (new)</span>
                    )}
                  </button>
                  <span className="shrink-0 font-mono text-[10.5px] opacity-80 group-hover:opacity-100">
                    <span className="text-hooman-success">+{adds}</span>{" "}
                    <span className="text-hooman-error">-{removes}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      title="Keep this change"
                      aria-label="Keep this change"
                      className="shrink-0 rounded p-1 text-hooman-muted hover:bg-slate-900 hover:text-slate-100"
                      onClick={() => onKeep(path)}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      title={
                        created
                          ? "Delete this new file"
                          : "Restore the original content"
                      }
                      aria-label={
                        created
                          ? "Delete this new file"
                          : "Restore the original content"
                      }
                      className="shrink-0 rounded p-1 text-hooman-muted hover:bg-slate-900 hover:text-slate-100"
                      onClick={() => onUndo(path)}
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <DiffCard path={path} oldText={oldText} newText={newText} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
