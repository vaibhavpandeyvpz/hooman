import { basename } from "node:path";
import * as vscode from "vscode";
import type {
  InstructionsEditorAction,
  InstructionsEditorStateInfo,
} from "./shared/settings";
import type { OutboundMessage, WebviewRoute } from "./shared/protocol";

interface PanelState {
  ready: boolean;
  disposed: boolean;
}

type InstructionsInboundMessage =
  | { type: "ready" }
  | { type: "instructionsEditorAction"; action: InstructionsEditorAction };

export class HoomanInstructionsEditorProvider
  implements vscode.CustomTextEditorProvider, vscode.Disposable
{
  static readonly viewType = "hooman.instructionsEditor";

  readonly #context: vscode.ExtensionContext;
  readonly #panels = new Map<vscode.WebviewPanel, PanelState>();

  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
  }

  dispose(): void {
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
    this.#panels.set(panel, { ready: false, disposed: false });

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
      (message: InstructionsInboundMessage) => {
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

  async revealDocument(
    uri: vscode.Uri,
    options?: { preserveFocus?: boolean; viewColumn?: vscode.ViewColumn },
  ): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      HoomanInstructionsEditorProvider.viewType,
      {
        preview: true,
        preserveFocus: options?.preserveFocus ?? false,
        viewColumn: options?.viewColumn,
      },
    );
  }

  async openRaw(document: vscode.TextDocument): Promise<void> {
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  }

  async #onMessage(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    message: InstructionsInboundMessage,
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
      case "instructionsEditorAction":
        await this.#handleAction(document, message.action);
        await this.#postState(panel, document);
        return;
    }
  }

  async #handleAction(
    document: vscode.TextDocument,
    action: InstructionsEditorAction,
  ): Promise<void> {
    switch (action.type) {
      case "refresh":
        return;
      case "openRaw":
        await this.openRaw(document);
        return;
      case "saveText": {
        const next = action.text.trim();
        if (!next) {
          throw new Error("instructions.md cannot be empty.");
        }
        await this.#replaceDocumentText(document, `${next}\n`);
        return;
      }
    }
  }

  async #replaceDocumentText(
    document: vscode.TextDocument,
    next: string,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const lastLine = document.lineAt(document.lineCount - 1);
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length),
      next,
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error("Failed to update instructions.md.");
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
    const state: InstructionsEditorStateInfo = {
      path: document.uri.fsPath,
      name: basename(document.uri.fsPath),
      dirty: document.isDirty,
      text: document.getText(),
    };
    const route: Extract<WebviewRoute, `/instructions/${string}`> =
      `/instructions/${encodeURIComponent(basename(document.uri.fsPath))}`;
    try {
      await panel.webview.postMessage({
        type: "route",
        route,
      } satisfies OutboundMessage);
      await panel.webview.postMessage({
        type: "instructionsEditorState",
        state,
      } satisfies OutboundMessage);
    } catch {
      panelState.disposed = true;
      this.#panels.delete(panel);
    }
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
    const route = `/instructions/${encodeURIComponent(title)}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>${escapeHtml(title)}</title>
</head>
<body data-route="${route}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function openHoomanInstructionsEditor(
  provider: HoomanInstructionsEditorProvider | undefined,
  uri: vscode.Uri,
  options?: { preserveFocus?: boolean; viewColumn?: vscode.ViewColumn },
): Promise<void> {
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
