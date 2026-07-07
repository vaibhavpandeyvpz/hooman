import * as vscode from "vscode";
import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import type { EditTracker } from "./edit-tracker";

/**
 * Backs the ACP `fs/*` client methods against VS Code's workspace APIs.
 * Edits go through undo-able workspace edits when a document is already
 * open in an editor, and are saved to disk immediately afterward so the
 * agent's changes are never left as an unsaved buffer for the user to
 * reconcile manually.
 */
export class FsBackend {
  #editTracker: EditTracker | undefined;

  /** Attach the tracker that snapshots baselines for the Changes panel. */
  setEditTracker(tracker: EditTracker): void {
    this.#editTracker = tracker;
  }

  async readTextFile(
    request: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    const uri = vscode.Uri.file(request.path);
    const text = await this.#readText(uri);
    const line = request.line ?? undefined;
    const limit = request.limit ?? undefined;
    if (line === undefined && limit === undefined) {
      return { content: text };
    }
    const lines = text.split(/\r\n|\r|\n/);
    const start = Math.max(0, (line ?? 1) - 1);
    const end = limit !== undefined ? start + limit : lines.length;
    return { content: lines.slice(start, end).join("\n") };
  }

  async writeTextFile(
    request: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse | void> {
    const uri = vscode.Uri.file(request.path);
    // Snapshot the pre-write content (null = file being created) so the
    // edit tracker can offer diff/keep/undo for this write.
    let before: string | null = null;
    try {
      before = await this.#readText(uri);
    } catch {
      before = null;
    }

    const open = this.#findOpenDocument(uri);
    if (open) {
      const fullRange = new vscode.Range(
        open.positionAt(0),
        open.positionAt(open.getText().length),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, request.content);
      await vscode.workspace.applyEdit(edit);
      // Persist to disk immediately so the agent's on-disk view stays in
      // sync and the user isn't left with an unsaved buffer to reconcile.
      const reopened = this.#findOpenDocument(uri);
      if (reopened?.isDirty) {
        await reopened.save();
      }
    } else {
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(request.content, "utf8"),
      );
    }
    this.#editTracker?.recordWrite(
      request.sessionId,
      uri.fsPath,
      before,
      request.content,
    );
  }

  async #readText(uri: vscode.Uri): Promise<string> {
    const open = this.#findOpenDocument(uri);
    if (open) {
      return open.getText();
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  }

  #findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find(
      (doc) => doc.uri.toString() === key,
    );
  }
}
