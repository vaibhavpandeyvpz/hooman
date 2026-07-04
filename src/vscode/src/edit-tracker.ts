import * as path from "node:path";
import * as vscode from "vscode";

/** Scheme used to serve pre-edit baselines to VS Code's diff editor. */
export const BASELINE_SCHEME = "hooman-baseline";

/** One agent-modified file, as surfaced to the webview Changes panel. */
export type TrackedEdit = {
  path: string;
  name: string;
  /** File did not exist before the agent's first write this session. */
  created: boolean;
  adds: number;
  removes: number;
};

type TrackedFile = {
  sessionId: string;
  /** Content before the agent's first write; null when the file was created. */
  baseline: string | null;
  current: string;
};

/**
 * Tracks files modified by the agent through the ACP `fs/write_text_file`
 * backend, keeping a per-session baseline snapshot so each edit can be
 * reviewed as a native diff and kept or undone — the "pending edits" model
 * used by many AI coding editor extensions.
 *
 * Also acts as the {@link vscode.TextDocumentContentProvider} for the
 * {@link BASELINE_SCHEME} scheme, serving baseline text to the diff editor.
 */
export class EditTracker
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  readonly #files = new Map<string, TrackedFile>();

  readonly #onDidChangeEdits = new vscode.EventEmitter<string>();
  /** Fires with the sessionId whose tracked edits changed. */
  readonly onDidChangeEdits = this.#onDidChangeEdits.event;

  readonly #onDidChange = new vscode.EventEmitter<vscode.Uri>();
  /** TextDocumentContentProvider change feed (baseline never mutates, but undo removes it). */
  readonly onDidChange = this.#onDidChange.event;

  /**
   * Record one agent write. The first write per file/session captures the
   * baseline; later writes only advance the current text. A file that ends
   * up byte-identical to its baseline is dropped (no net change).
   */
  recordWrite(
    sessionId: string,
    fsPath: string,
    before: string | null,
    after: string,
  ): void {
    const existing = this.#files.get(fsPath);
    if (existing && existing.sessionId === sessionId) {
      existing.current = after;
      if (existing.baseline !== null && existing.baseline === after) {
        this.#files.delete(fsPath);
      }
    } else {
      this.#files.set(fsPath, { sessionId, baseline: before, current: after });
    }
    this.#onDidChangeEdits.fire(sessionId);
  }

  /** Pending edits for one session, ordered by path. */
  listFor(sessionId: string): TrackedEdit[] {
    const edits: TrackedEdit[] = [];
    for (const [fsPath, file] of this.#files) {
      if (file.sessionId !== sessionId) {
        continue;
      }
      const { adds, removes } = lineDiffStats(
        file.baseline ?? "",
        file.current,
      );
      edits.push({
        path: fsPath,
        name: path.basename(fsPath),
        created: file.baseline === null,
        adds,
        removes,
      });
    }
    return edits.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Open the baseline ↔ current comparison in the native diff editor.
   * Returns false when the file is no longer tracked (kept/undone), so the
   * caller can fall back to just opening the file.
   */
  async openDiff(fsPath: string): Promise<boolean> {
    const file = this.#files.get(fsPath);
    if (!file) {
      return false;
    }
    const baselineUri = vscode.Uri.file(fsPath).with({
      scheme: BASELINE_SCHEME,
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      baselineUri,
      vscode.Uri.file(fsPath),
      `${path.basename(fsPath)} (Hooman edits)`,
    );
    return true;
  }

  /** Accept an edit: stop tracking it, keeping the file as-is. */
  keep(fsPath: string): void {
    const file = this.#files.get(fsPath);
    if (!file) {
      return;
    }
    this.#files.delete(fsPath);
    this.#onDidChangeEdits.fire(file.sessionId);
  }

  keepAll(sessionId: string): void {
    for (const [fsPath, file] of [...this.#files]) {
      if (file.sessionId === sessionId) {
        this.#files.delete(fsPath);
      }
    }
    this.#onDidChangeEdits.fire(sessionId);
  }

  /** Revert an edit: restore the baseline (or delete a created file). */
  async undo(fsPath: string): Promise<void> {
    const file = this.#files.get(fsPath);
    if (!file) {
      return;
    }
    await restoreFile(fsPath, file.baseline);
    this.#files.delete(fsPath);
    this.#onDidChange.fire(
      vscode.Uri.file(fsPath).with({ scheme: BASELINE_SCHEME }),
    );
    this.#onDidChangeEdits.fire(file.sessionId);
  }

  async undoAll(sessionId: string): Promise<void> {
    for (const [fsPath, file] of [...this.#files]) {
      if (file.sessionId === sessionId) {
        await this.undo(fsPath);
      }
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.#files.get(uri.fsPath)?.baseline ?? "";
  }

  dispose(): void {
    this.#onDidChangeEdits.dispose();
    this.#onDidChange.dispose();
    this.#files.clear();
  }
}

/** Restore a file to its baseline content; a null baseline deletes it. */
async function restoreFile(
  fsPath: string,
  baseline: string | null,
): Promise<void> {
  const uri = vscode.Uri.file(fsPath);
  if (baseline === null) {
    await vscode.workspace.fs.delete(uri, { useTrash: true });
    return;
  }
  const open = vscode.workspace.textDocuments.find(
    (doc) => doc.uri.toString() === uri.toString(),
  );
  if (open) {
    const fullRange = new vscode.Range(
      open.positionAt(0),
      open.positionAt(open.getText().length),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, baseline);
    await vscode.workspace.applyEdit(edit);
    await open.save();
    return;
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(baseline, "utf8"));
}

/**
 * Cheap added/removed line counts: trim the common prefix/suffix and count
 * what remains on each side. Not a minimal diff, but stable and O(n).
 */
function lineDiffStats(
  oldText: string,
  newText: string,
): { adds: number; removes: number } {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return { removes: endA - start, adds: endB - start };
}
