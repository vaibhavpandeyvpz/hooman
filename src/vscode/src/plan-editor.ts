import { basename, dirname, isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { HoomanChatViewProvider } from "./chat-view";
import type {
  OutboundMessage,
  PlanEditorStateInfo,
  WebviewRoute,
} from "./shared/protocol";
import { isPlanFileUri, openFile } from "./plan-file";

const CONFIG_ID_MODE = "mode";
const CONFIG_ID_MODEL = "model";
const MODE_VALUE_AGENT = "agent";

type PanelState = {
  document: vscode.TextDocument;
  ready: boolean;
  disposed: boolean;
};

export class PlanEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "hooman.planEditor";

  readonly #context: vscode.ExtensionContext;
  readonly #chatView: HoomanChatViewProvider;
  readonly #disposables: vscode.Disposable[] = [];
  readonly #panels = new Map<vscode.WebviewPanel, PanelState>();

  constructor(
    context: vscode.ExtensionContext,
    chatView: HoomanChatViewProvider,
  ) {
    this.#context = context;
    this.#chatView = chatView;

    this.#disposables.push(
      this.#chatView.onDidChangeSessionState(() => {
        for (const [panel, state] of this.#panels) {
          void this.#postState(panel, state.document);
        }
      }),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.#disposables).dispose();
    this.#panels.clear();
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.#context.extensionUri, "media"),
      ],
    };
    panel.webview.html = this.#html(panel.webview, document);
    this.#panels.set(panel, {
      document,
      ready: false,
      disposed: false,
    });

    const changeDoc = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      void this.#postState(panel, document);
    });

    const changeViewState = panel.onDidChangeViewState(() => {
      if (panel.active) {
        void this.#postState(panel, document);
      }
    });

    const receiveMessage = panel.webview.onDidReceiveMessage(
      (message: PlanEditorInboundMessage) => {
        void this.#onMessage(panel, document, message);
      },
    );

    const disposePanel = panel.onDidDispose(() => {
      const state = this.#panels.get(panel);
      if (state) {
        state.disposed = true;
      }
      this.#panels.delete(panel);
      changeDoc.dispose();
      changeViewState.dispose();
      receiveMessage.dispose();
      disposePanel.dispose();
    });
  }

  async buildDocument(document: vscode.TextDocument): Promise<void> {
    const mode = this.#findConfigOption(CONFIG_ID_MODE);
    if (mode?.type === "select" && mode.currentValue !== MODE_VALUE_AGENT) {
      await this.#chatView.setConfigOption(mode.id, MODE_VALUE_AGENT, false);
    }
    this.#chatView.submitPrompt(`Build this plan now: ${document.uri.fsPath}`);
  }

  async revealDocument(
    uri: vscode.Uri,
    options?: { preserveFocus?: boolean; viewColumn?: vscode.ViewColumn },
  ): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      PlanEditorProvider.viewType,
      {
        preview: true,
        preserveFocus: options?.preserveFocus ?? false,
        viewColumn: options?.viewColumn,
      },
    );
  }

  async openRawMarkdown(document: vscode.TextDocument): Promise<void> {
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  }

  async pickModel(): Promise<void> {
    const option = this.#findConfigOption(CONFIG_ID_MODEL);
    if (!option || option.type !== "select") {
      void vscode.window.showWarningMessage(
        "Hooman: no model picker is available for the current session.",
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      flattenSelectOptions(option.options).map((entry) => ({
        label: entry.name,
        description:
          entry.value === option.currentValue ? "current" : undefined,
        detail: entry.description ?? undefined,
        value: entry.value,
      })),
      { placeHolder: option.name },
    );
    if (picked) {
      await this.#chatView.setConfigOption(option.id, picked.value, false);
    }
  }

  async #onMessage(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    message: PlanEditorInboundMessage,
  ): Promise<void> {
    switch (message.type) {
      case "ready": {
        const state = this.#panels.get(panel);
        if (state) {
          state.ready = true;
        }
        await this.#postState(panel, document);
        return;
      }
      case "refresh":
        await this.#postState(panel, document);
        return;
      case "pickModel":
        await this.pickModel();
        await this.#postState(panel, document);
        return;
      case "build":
        await this.buildDocument(document);
        await this.#postState(panel, document);
        return;
      case "editMarkdown":
        await this.openRawMarkdown(document);
        return;
      case "openLink":
        await this.#openLink(document, message.href);
        return;
    }
  }

  /**
   * Open a link clicked inside the rendered plan body: external URLs go to
   * the OS handler, everything else is a filesystem path resolved relative
   * to the plan file's own directory when not already absolute.
   */
  async #openLink(document: vscode.TextDocument, href: string): Promise<void> {
    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href) || href.startsWith("mailto:")) {
        await vscode.env.openExternal(vscode.Uri.parse(href));
        return;
      }
      const clean = href.split(/[?#]/)[0] || href;
      const target = isAbsolute(clean)
        ? clean
        : join(dirname(document.uri.fsPath), clean);
      const uri = vscode.Uri.file(target);
      let isDirectory = false;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
      } catch {
        // Missing on disk — let `vscode.open` surface the error.
      }
      if (isDirectory) {
        try {
          await vscode.commands.executeCommand("revealInExplorer", uri);
        } catch {
          await vscode.commands.executeCommand("revealFileInOS", uri);
        }
        return;
      }
      await openFile(uri, { provider: this });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Hooman: could not open ${href}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #postState(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
  ): Promise<void> {
    const panelState = this.#panels.get(panel);
    if (!panelState || panelState.disposed || !panelState.ready) {
      return;
    }
    const route: Extract<WebviewRoute, `/plans/${string}`> =
      `/plans/${encodeURIComponent(basename(document.uri.fsPath))}`;
    const state: PlanEditorStateInfo = {
      path: document.uri.fsPath,
      name: basename(document.uri.fsPath),
      text: document.getText(),
      modelLabel: this.#currentModelInfo().label,
      modeLabel: this.#currentModeLabel(),
      busy: this.#chatView.isBusy,
      dirty: document.isDirty,
    };
    try {
      await panel.webview.postMessage({
        type: "route",
        route,
      } satisfies OutboundMessage);
      await panel.webview.postMessage({
        type: "planState",
        state,
      } satisfies OutboundMessage);
    } catch {
      panelState.disposed = true;
      this.#panels.delete(panel);
    }
  }

  #currentModelInfo(): { label: string; value?: string } {
    const option = this.#findConfigOption(CONFIG_ID_MODEL);
    if (!option || option.type !== "select") {
      return { label: "Model" };
    }
    const current = flattenSelectOptions(option.options).find(
      (entry) => entry.value === option.currentValue,
    );
    return {
      label: current?.name ?? String(option.currentValue),
      value: option.currentValue,
    };
  }

  #currentModeLabel(): string | undefined {
    const option = this.#findConfigOption(CONFIG_ID_MODE);
    if (!option || option.type !== "select") {
      return undefined;
    }
    const current = flattenSelectOptions(option.options).find(
      (entry) => entry.value === option.currentValue,
    );
    return current?.name ?? String(option.currentValue);
  }

  #findConfigOption(idOrCategory: string): SessionConfigOption | undefined {
    return this.#chatView.configOptions.find(
      (option) =>
        option.id === idOrCategory || option.category === idOrCategory,
    );
  }

  #html(webview: vscode.Webview, document: vscode.TextDocument): string {
    const mediaRoot = vscode.Uri.joinPath(this.#context.extensionUri, "media");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.js"),
    );
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    const title = basename(document.uri.fsPath);
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>${escapeHtml(title)}</title>
</head>
<body data-route="/plans/${encodeURIComponent(title)}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

type PlanEditorInboundMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "pickModel" }
  | { type: "build" }
  | { type: "editMarkdown" }
  | { type: "openLink"; href: string };

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function openPlanEditor(
  provider: PlanEditorProvider | undefined,
  uri: vscode.Uri,
  options?: { preserveFocus?: boolean; viewColumn?: vscode.ViewColumn },
): Promise<void> {
  if (!isPlanFileUri(uri)) {
    return;
  }
  if (provider) {
    await provider.revealDocument(uri, options);
    return;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: options?.preserveFocus ?? false,
    viewColumn: options?.viewColumn,
  });
}
