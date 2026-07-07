import * as vscode from "vscode";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { EditTracker } from "./edit-tracker";
import type { HoomanChatViewProvider } from "./chat-view";
import type { PlanEditorProvider } from "./plan-editor";
import { isPlanFileUri, openPlanFile } from "./plan-file";

const PLAN_EDITOR_CONTEXT = "hooman.isPlanEditor";
const CONFIG_ID_MODE = "mode";
const CONFIG_ID_MODEL = "model";
const MODE_VALUE_AGENT = "agent";

export class PlanFileActions implements vscode.Disposable {
  readonly #disposables: vscode.Disposable[] = [];
  #lastRevealedPlanPath: string | null = null;
  #reopeningPreview = false;
  #previewNormalized = new Set<string>();

  constructor(
    private readonly chatView: HoomanChatViewProvider,
    editTracker: EditTracker,
    private readonly planEditor?: PlanEditorProvider,
  ) {
    this.#disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.#syncActivePlanContext();
        void this.#ensurePreviewForActivePlanEditor(editor);
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isPlanFileUri(document.uri)) {
          this.#previewNormalized.delete(document.uri.toString());
          void this.#syncActivePlanContext();
        }
      }),
      editTracker.onDidChangeEdits((sessionId) => {
        if (sessionId !== this.chatView.currentSessionId) {
          return;
        }
        void this.#revealTrackedPlanFiles(editTracker, sessionId);
      }),
    );
    void this.#syncActivePlanContext();
  }

  async pickModel(): Promise<void> {
    const option = this.#findConfigOption(CONFIG_ID_MODEL);
    if (!option || option.type !== "select") {
      void vscode.window.showWarningMessage(
        "Hooman: no model picker is available for the current session.",
      );
      return;
    }
    const entries = flattenSelectOptions(option.options);
    const picked = await vscode.window.showQuickPick(
      entries.map((item) => ({
        label: item.name,
        description: item.value === option.currentValue ? "current" : undefined,
        detail: item.description ?? undefined,
        value: item.value,
      })),
      { placeHolder: option.name },
    );
    if (picked) {
      await this.chatView.setConfigOption(option.id, picked.value, false);
    }
  }

  async buildActivePlan(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isPlanFileUri(editor.document.uri)) {
      void vscode.window.showWarningMessage(
        "Hooman: open a .plan.md file to use Build.",
      );
      return;
    }
    const planUri = editor.document.uri;

    const mode = this.#findConfigOption(CONFIG_ID_MODE);
    if (mode?.type === "select" && mode.currentValue !== MODE_VALUE_AGENT) {
      await this.chatView.setConfigOption(mode.id, MODE_VALUE_AGENT, false);
    }

    this.chatView.submitPrompt(`Build this plan now: ${planUri.fsPath}`);
  }

  dispose(): void {
    vscode.Disposable.from(...this.#disposables).dispose();
  }

  async #syncActivePlanContext(): Promise<void> {
    await vscode.commands.executeCommand(
      "setContext",
      PLAN_EDITOR_CONTEXT,
      isPlanFileUri(vscode.window.activeTextEditor?.document.uri),
    );
  }

  async #revealTrackedPlanFiles(
    editTracker: EditTracker,
    sessionId: string,
  ): Promise<void> {
    const latest = editTracker
      .listFor(sessionId)
      .map((edit) => edit.path)
      .filter((path) => isPlanFileUri(vscode.Uri.file(path)))
      .sort()
      .at(-1);
    if (!latest || latest === this.#lastRevealedPlanPath) {
      return;
    }
    this.#lastRevealedPlanPath = latest;
    try {
      await openPlanFile(vscode.Uri.file(latest), {
        provider: this.planEditor,
      });
    } catch {
      // Ignore transient open failures; the edit still exists and can be opened manually.
    }
  }

  async #ensurePreviewForActivePlanEditor(
    editor: vscode.TextEditor | undefined,
  ): Promise<void> {
    if (
      this.#reopeningPreview ||
      !editor ||
      !isPlanFileUri(editor.document.uri)
    ) {
      return;
    }
    const key = editor.document.uri.toString();
    if (this.#previewNormalized.has(key)) {
      return;
    }
    this.#previewNormalized.add(key);
    this.#reopeningPreview = true;
    try {
      await openPlanFile(editor.document.uri, {
        preserveFocus: false,
        viewColumn: editor.viewColumn,
        provider: this.planEditor,
      });
    } catch {
      this.#previewNormalized.delete(key);
    } finally {
      this.#reopeningPreview = false;
    }
  }

  #findConfigOption(idOrCategory: string): SessionConfigOption | undefined {
    return this.chatView.configOptions.find(
      (option) =>
        option.id === idOrCategory || option.category === idOrCategory,
    );
  }
}

type FlatOption = { value: string; name: string; description?: string | null };

function flattenSelectOptions(
  options: Extract<SessionConfigOption, { type: "select" }>["options"],
): FlatOption[] {
  const flat: FlatOption[] = [];
  for (const entry of options ?? []) {
    if ("options" in entry && Array.isArray(entry.options)) {
      flat.push(...entry.options);
    } else {
      flat.push(entry as FlatOption);
    }
  }
  return flat;
}
