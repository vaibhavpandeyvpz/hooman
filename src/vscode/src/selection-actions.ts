import * as vscode from "vscode";

/**
 * Floating "Add Selection to Hooman Chat" / "Add Selection to New Hooman
 * Chat" CodeLens,
 * shown above the first line of a non-empty editor selection — the closest
 * public-API equivalent of Cursor's floating selection toolbar.
 */
export class SelectionActionsCodeLensProvider
  implements vscode.CodeLensProvider
{
  #onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.#onDidChangeCodeLenses.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this.#onDidChangeCodeLenses,
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.#onDidChangeCodeLenses.fire();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.#onDidChangeCodeLenses.fire();
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document || editor.selection.isEmpty) {
      return [];
    }
    const range = new vscode.Range(
      editor.selection.start.line,
      0,
      editor.selection.start.line,
      0,
    );
    return [
      new vscode.CodeLens(range, {
        title: "Add Selection to Hooman Chat",
        command: "hooman.addSelectionToChat",
      }),
      new vscode.CodeLens(range, {
        title: "Add Selection to New Hooman Chat",
        command: "hooman.addSelectionToNewChat",
      }),
    ];
  }
}
