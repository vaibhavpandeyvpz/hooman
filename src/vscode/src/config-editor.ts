import { basename } from "node:path";
import * as vscode from "vscode";
import { confirmDelete } from "./confirm";
import type { ConfigEditorAction, McpEditorAction } from "./shared/settings";
import type { OutboundMessage, WebviewRoute } from "./shared/protocol";
import type {
  ConfigEditorStateInfo,
  McpEditorStateInfo,
} from "./shared/settings";
import {
  authenticateMcpServer,
  deleteConfigLlm,
  deleteConfigProvider,
  deleteMcpServer,
  homeMcpPath,
  isHoomanConfigPath,
  isHoomanMcpPath,
  loadConfigState,
  loadMcpState,
  logoutMcpServer,
  openTextFile,
  saveConfigGeneral,
  saveConfigLlm,
  saveConfigPromptToggle,
  saveConfigProvider,
  saveConfigSearch,
  saveConfigToolToggle,
  saveMcpServer,
  scopeForPath,
  setDefaultConfigLlm,
} from "./settings-utils";

interface PanelState {
  ready: boolean;
  disposed: boolean;
}

type ConfigInboundMessage =
  | { type: "ready" }
  | { type: "configEditorAction"; action: ConfigEditorAction }
  | { type: "mcpEditorAction"; action: McpEditorAction };

export class HoomanConfigEditorProvider
  implements vscode.CustomTextEditorProvider, vscode.Disposable
{
  static readonly viewType = "hooman.configEditor";

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
    panel.webview.html = this.#html(panel.webview, document, true);
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
      (message: ConfigInboundMessage) => {
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
      HoomanConfigEditorProvider.viewType,
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
    message: ConfigInboundMessage,
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
      case "configEditorAction":
        await this.#handleConfigAction(document, message.action);
        await this.#postState(panel, document);
        return;
      case "mcpEditorAction":
        return;
    }
  }

  async #handleConfigAction(
    document: vscode.TextDocument,
    action: ConfigEditorAction,
  ): Promise<void> {
    switch (action.type) {
      case "refresh":
        return;
      case "openRaw":
        await this.openRaw(document);
        return;
      case "openRelatedGlobal":
        if (scopeForPath(document.uri.fsPath) === "project") {
          const uri = vscode.Uri.file(
            document.uri.fsPath.replace(
              /\.hooman\/config\.json$/,
              "/.hooman/config.json",
            ),
          );
          try {
            await this.revealDocument(uri);
          } catch {
            await openTextFile(uri.fsPath);
          }
        }
        return;
      case "saveGeneral":
        await this.#replaceDocumentText(
          document,
          saveConfigGeneral(document.getText(), {
            appName: action.appName,
            reasoning: action.reasoning,
            compactionRatio: action.compactionRatio,
            compactionKeep: action.compactionKeep,
          }),
        );
        return;
      case "setPromptToggle":
        await this.#replaceDocumentText(
          document,
          saveConfigPromptToggle(document.getText(), action.key, action.value),
        );
        return;
      case "setToolToggle":
        await this.#replaceDocumentText(
          document,
          saveConfigToolToggle(document.getText(), action.key, action.value),
        );
        return;
      case "saveSearch":
        await this.#replaceDocumentText(
          document,
          saveConfigSearch(document.getText(), {
            enabled: action.enabled,
            provider: action.provider,
            apiKey: action.apiKey,
            baseURL: action.baseURL,
            tool: action.tool,
          }),
        );
        return;
      case "saveProvider":
        await this.#replaceDocumentText(
          document,
          saveConfigProvider(
            document.getText(),
            action.originalName,
            action.providerType,
            action.fields,
          ),
        );
        return;
      case "deleteProvider":
        if (
          !(await confirmDelete(
            `Delete provider "${action.name}"?`,
            "This removes the provider from config.json.",
          ))
        ) {
          return;
        }
        await this.#replaceDocumentText(
          document,
          deleteConfigProvider(document.getText(), action.name),
        );
        return;
      case "saveLlm":
        await this.#replaceDocumentText(
          document,
          saveConfigLlm(document.getText(), action.originalName, action.fields),
        );
        return;
      case "deleteLlm":
        if (
          !(await confirmDelete(
            `Delete model "${action.name}"?`,
            "This removes the model from config.json.",
          ))
        ) {
          return;
        }
        await this.#replaceDocumentText(
          document,
          deleteConfigLlm(document.getText(), action.name),
        );
        return;
      case "setDefaultLlm":
        await this.#replaceDocumentText(
          document,
          setDefaultConfigLlm(document.getText(), action.name),
        );
        return;
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
      throw new Error("Failed to update config.json.");
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
    const state: ConfigEditorStateInfo = {
      ...loadConfigState(document.uri.fsPath, document.getText()),
      dirty: document.isDirty,
    };
    const route: Extract<WebviewRoute, `/config/${string}`> =
      `/config/${encodeURIComponent(basename(document.uri.fsPath))}`;
    try {
      await panel.webview.postMessage({
        type: "route",
        route,
      } satisfies OutboundMessage);
      await panel.webview.postMessage({
        type: "configEditorState",
        state,
      } satisfies OutboundMessage);
    } catch {
      panelState.disposed = true;
      this.#panels.delete(panel);
    }
  }

  #html(
    webview: vscode.Webview,
    document: vscode.TextDocument,
    isConfig: boolean,
  ): string {
    const mediaRoot = vscode.Uri.joinPath(this.#context.extensionUri, "media");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.js"),
    );
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    const title = basename(document.uri.fsPath);
    const route = isConfig
      ? `/config/${encodeURIComponent(title)}`
      : `/mcp/${encodeURIComponent(title)}`;
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

export class HoomanMcpEditorProvider
  implements vscode.CustomTextEditorProvider, vscode.Disposable
{
  static readonly viewType = "hooman.mcpEditor";

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
      (message: ConfigInboundMessage) => {
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
      HoomanMcpEditorProvider.viewType,
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
    message: ConfigInboundMessage,
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
      case "mcpEditorAction":
        await this.#handleMcpAction(document, message.action);
        await this.#postState(panel, document);
        return;
      case "configEditorAction":
        return;
    }
  }

  async #handleMcpAction(
    document: vscode.TextDocument,
    action: McpEditorAction,
  ): Promise<void> {
    switch (action.type) {
      case "refresh":
        return;
      case "openRaw":
        await this.openRaw(document);
        return;
      case "openRelatedGlobal":
        await this.#openRelated(document, homeMcpPath());
        return;
      case "openRelatedProject": {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (folder) {
          await this.#openRelated(document, `${folder}/.hooman/mcp.json`);
        }
        return;
      }
      case "saveServer":
        await this.#replaceDocumentText(
          document,
          saveMcpServer(
            document.getText(),
            action.originalName,
            action.transportType,
            action.fields,
          ),
        );
        return;
      case "deleteServer":
        if (
          !(await confirmDelete(
            `Delete MCP server "${action.name}"?`,
            "This removes the server from mcp.json.",
          ))
        ) {
          return;
        }
        await this.#replaceDocumentText(
          document,
          deleteMcpServer(document.getText(), action.name),
        );
        return;
      case "authenticate":
        await authenticateMcpServer(action.name);
        return;
      case "logout": {
        const state = loadMcpState(document.uri.fsPath, document.getText());
        const server = state.servers.find(
          (entry) => entry.name === action.name,
        );
        if (server) {
          logoutMcpServer(action.name, server.transport);
        }
        return;
      }
    }
  }

  async #openRelated(
    _document: vscode.TextDocument,
    path: string,
  ): Promise<void> {
    try {
      const uri = vscode.Uri.file(path);
      if (isHoomanMcpPath(path)) {
        await this.revealDocument(uri);
      } else if (isHoomanConfigPath(path)) {
        await vscode.window.showTextDocument(uri);
      }
    } catch {
      await openTextFile(path);
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
      throw new Error("Failed to update mcp.json.");
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
    const state: McpEditorStateInfo = {
      ...loadMcpState(document.uri.fsPath, document.getText()),
      dirty: document.isDirty,
    };
    const route: Extract<WebviewRoute, `/mcp/${string}`> =
      `/mcp/${encodeURIComponent(basename(document.uri.fsPath))}`;
    try {
      await panel.webview.postMessage({
        type: "route",
        route,
      } satisfies OutboundMessage);
      await panel.webview.postMessage({
        type: "mcpEditorState",
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
    const route = `/mcp/${encodeURIComponent(title)}`;
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

export async function openHoomanConfigEditor(
  provider: HoomanConfigEditorProvider | undefined,
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

export async function openHoomanMcpEditor(
  provider: HoomanMcpEditorProvider | undefined,
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
