import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { lineDiffStats } from "./line-diff-stats";
import { isPlanFilePath } from "./plan-file";

/** Scheme used to serve pre-edit baselines to VS Code's diff editor. */
const SNAPSHOT_QUERY_KEY = "snapshot";
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
 * One prompt turn's per-file baselines, in write order, for turn-scoped
 * revert. Keyed by the turn's `messageId` — the ACP MessageId RFD's
 * agent-generated id for the turn's user message, not a client-minted one.
 */
type TrackedTurn = {
  messageId: string;
  /** Baseline (pre-write) content per file, captured on that file's first write in this turn. */
  baselines: Map<string, string | null>;
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

  /** Ordered per-session turn history, oldest first, for turn-scoped revert. */
  readonly #turns = new Map<string, TrackedTurn[]>();
  /** The turn currently receiving writes, per session. */
  readonly #currentTurn = new Map<string, string>();

  readonly #onDidChangeEdits = new vscode.EventEmitter<string>();
  readonly #snapshots = new Map<string, string>();
  readonly #snapshotCloseSubscription: vscode.Disposable;

  constructor() {
    this.#snapshotCloseSubscription = vscode.workspace.onDidCloseTextDocument(
      (document) => {
        if (document.uri.scheme !== BASELINE_SCHEME) {
          return;
        }
        const snapshotId = new URLSearchParams(document.uri.query).get(
          SNAPSHOT_QUERY_KEY,
        );
        if (snapshotId) {
          this.#snapshots.delete(snapshotId);
        }
      },
    );
  }
  /** Fires with the sessionId whose tracked edits changed. */
  readonly onDidChangeEdits = this.#onDidChangeEdits.event;

  readonly #onDidChange = new vscode.EventEmitter<vscode.Uri>();
  /** TextDocumentContentProvider change feed (baseline never mutates, but undo removes it). */
  readonly onDidChange = this.#onDidChange.event;

  /**
   * Start tracking a new prompt turn for a session, identified by the ACP
   * `messageId` the agent generated for that turn's user message (see the
   * MessageId RFD). Subsequent writes are attributed to `messageId` until
   * the next `beginTurn` call, so a later {@link revertToTurn} can undo
   * exactly the files touched from that turn onward.
   */
  beginTurn(sessionId: string, messageId: string): void {
    const turns = this.#turns.get(sessionId) ?? [];
    turns.push({ messageId, baselines: new Map() });
    this.#turns.set(sessionId, turns);
    this.#currentTurn.set(sessionId, messageId);
  }

  /** Drop all turn history for a session (e.g. on tab close/session switch). */
  clearTurns(sessionId: string): void {
    this.#turns.delete(sessionId);
    this.#currentTurn.delete(sessionId);
  }

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
    if (isPlanFilePath(fsPath)) {
      const existing = this.#files.get(fsPath);
      if (existing) {
        this.#files.delete(fsPath);
        this.#onDidChangeEdits.fire(existing.sessionId);
      }
      return;
    }

    const existing = this.#files.get(fsPath);
    if (existing && existing.sessionId === sessionId) {
      existing.current = after;
      if (existing.baseline !== null && existing.baseline === after) {
        this.#files.delete(fsPath);
      }
    } else {
      this.#files.set(fsPath, { sessionId, baseline: before, current: after });
    }

    const messageId = this.#currentTurn.get(sessionId);
    if (messageId) {
      const turn = this.#turns
        .get(sessionId)
        ?.find((entry) => entry.messageId === messageId);
      if (turn && !turn.baselines.has(fsPath)) {
        turn.baselines.set(fsPath, before);
      }
    }

    this.#onDidChangeEdits.fire(sessionId);
  }

  /** Pending edits for one session, ordered by path. */
  listFor(sessionId: string): TrackedEdit[] {
    const edits: TrackedEdit[] = [];
    for (const [fsPath, file] of this.#files) {
      if (file.sessionId !== sessionId || isPlanFilePath(fsPath)) {
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
  async openDiff(
    fsPath: string,
    line?: number,
    snapshots?: { oldText: string | null; newText: string },
  ): Promise<boolean> {
    const file = this.#files.get(fsPath);
    if (!file && !snapshots) {
      return false;
    }
    const fileUri = vscode.Uri.file(fsPath);
    const snapshotUri = (content: string): vscode.Uri => {
      const id = randomUUID();
      this.#snapshots.set(id, content);
      return fileUri.with({
        scheme: BASELINE_SCHEME,
        query: `${SNAPSHOT_QUERY_KEY}=${id}`,
      });
    };
    const baselineUri = snapshots
      ? snapshotUri(snapshots.oldText ?? "")
      : fileUri.with({ scheme: BASELINE_SCHEME });
    const modifiedUri = snapshots ? snapshotUri(snapshots.newText) : fileUri;
    const lineCount = snapshots
      ? Math.max(1, snapshots.newText.split(/\r?\n/).length)
      : Math.max(
          1,
          (await vscode.workspace.openTextDocument(fileUri)).lineCount,
        );
    const targetLine =
      line === undefined ? undefined : Math.min(Math.max(1, line), lineCount);
    await vscode.commands.executeCommand(
      "vscode.diff",
      baselineUri,
      modifiedUri,
      `${path.basename(fsPath)} (Hooman edits)`,
      targetLine !== undefined
        ? {
            preview: false,
            selection: new vscode.Range(targetLine - 1, 0, targetLine - 1, 0),
          }
        : undefined,
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

  /**
   * Revert every file touched by the turn whose user message carries
   * `messageId`, and any later turn, back to its state immediately before
   * that turn started, then discard those turns from history (they can no
   * longer be reverted individually).
   *
   * For each file the earliest baseline across the reverted turns wins,
   * since that is the state the file was in right before the turn began.
   */
  async revertToTurn(sessionId: string, messageId: string): Promise<void> {
    const turns = this.#turns.get(sessionId);
    if (!turns) {
      return;
    }
    const startIndex = turns.findIndex(
      (entry) => entry.messageId === messageId,
    );
    if (startIndex === -1) {
      return;
    }
    const reverted = turns.slice(startIndex);

    const baselineByPath = new Map<string, string | null>();
    for (const turn of reverted) {
      for (const [fsPath, baseline] of turn.baselines) {
        if (!baselineByPath.has(fsPath)) {
          baselineByPath.set(fsPath, baseline);
        }
      }
    }

    for (const [fsPath, baseline] of baselineByPath) {
      await restoreFile(fsPath, baseline);
      const file = this.#files.get(fsPath);
      if (file && file.sessionId === sessionId) {
        // The file now reads back as `baseline`. If that matches the
        // session-wide baseline (pre-dating this turn) there is no longer a
        // net change to show in the Changes panel; otherwise keep the entry
        // with its current content updated to the restored text.
        if (file.baseline === baseline) {
          this.#files.delete(fsPath);
        } else {
          file.current = baseline ?? "";
        }
      }
      this.#onDidChange.fire(
        vscode.Uri.file(fsPath).with({ scheme: BASELINE_SCHEME }),
      );
    }

    const remaining = turns.slice(0, startIndex);
    this.#turns.set(sessionId, remaining);
    const last = remaining[remaining.length - 1];
    if (last) {
      this.#currentTurn.set(sessionId, last.messageId);
    } else {
      this.#currentTurn.delete(sessionId);
    }

    if (baselineByPath.size > 0) {
      this.#onDidChangeEdits.fire(sessionId);
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const query = new URLSearchParams(uri.query);
    const snapshotId = query.get(SNAPSHOT_QUERY_KEY);
    return (
      (snapshotId ? this.#snapshots.get(snapshotId) : undefined) ??
      this.#files.get(uri.fsPath)?.baseline ??
      ""
    );
  }

  dispose(): void {
    this.#onDidChangeEdits.dispose();
    this.#onDidChange.dispose();
    this.#snapshotCloseSubscription.dispose();
    this.#files.clear();
    this.#snapshots.clear();
    this.#turns.clear();
    this.#currentTurn.clear();
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
