import { basename, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { methods } from "@agentclientprotocol/sdk";
import { HoomanAcpClient } from "./acp-client";
import { HoomanChatViewProvider } from "./chat-view";
import {
  HoomanConfigEditorProvider,
  HoomanMcpEditorProvider,
  openHoomanConfigEditor,
  openHoomanMcpEditor,
} from "./config-editor";
import { BASELINE_SCHEME, EditTracker } from "./edit-tracker";
import { PlanEditorProvider } from "./plan-editor";
import { PlanFileActions } from "./plan-actions";
import { PermissionPrompts } from "./permissions";
import { SelectionActionsCodeLensProvider } from "./selection-actions";
import {
  defaultConfigScaffold,
  defaultMcpScaffold,
  homeConfigPath,
  homeInstructionsPath,
  homeMcpPath,
  isHoomanConfigPath,
  isHoomanMcpPath,
  openTextFile,
} from "./settings-utils";
import { HoomanSkillsPanel } from "./skills-panel";
import { HoomanStatusBar } from "./status-bar";

type LauncherAction =
  | "open-config"
  | "open-mcp"
  | "open-instructions"
  | "open-skills"
  | "open-raw-config"
  | "open-raw-mcp";

async function ensureTextFile(path: string, scaffold: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, scaffold, { flag: "wx" });
  } catch {
    // Already exists.
  }
}

async function pickLauncherAction(): Promise<LauncherAction | undefined> {
  const items: Array<vscode.QuickPickItem & { value: LauncherAction }> = [
    {
      label: "$(settings-gear) Open Hooman configuration",
      description: "Visual editor for .hooman/config.json",
      value: "open-config",
    },
    {
      label: "$(plug) Open Hooman MCP",
      description: "Visual editor for .hooman/mcp.json",
      value: "open-mcp",
    },
    {
      label: "$(book) Open instructions",
      description: "Edit ~/.hooman/instructions.md in the default editor",
      value: "open-instructions",
    },
    {
      label: "$(extensions) Open skills manager",
      description: "Search, install, and remove Hooman skills",
      value: "open-skills",
    },
  ];
  items.push(
    {
      label: "$(json) Open raw config.json",
      description: "Open ~/.hooman/config.json in text editor",
      value: "open-raw-config",
    },
    {
      label: "$(json) Open raw mcp.json",
      description: "Open ~/.hooman/mcp.json in text editor",
      value: "open-raw-mcp",
    },
  );
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Open a Hooman configuration surface",
  });
  return picked?.value;
}

async function openConfigurationSurface(
  configEditor: HoomanConfigEditorProvider | undefined,
): Promise<void> {
  const path = homeConfigPath();
  await ensureTextFile(path, defaultConfigScaffold(true));
  await openHoomanConfigEditor(configEditor, vscode.Uri.file(path));
}

async function openMcpSurface(
  mcpEditor: HoomanMcpEditorProvider | undefined,
): Promise<void> {
  const path = homeMcpPath();
  await ensureTextFile(path, defaultMcpScaffold());
  await openHoomanMcpEditor(mcpEditor, vscode.Uri.file(path));
}

async function openInstructions(): Promise<void> {
  await openRaw(homeInstructionsPath(), "# Hooman Instructions\n");
}

async function openRaw(path: string, scaffold: string): Promise<void> {
  await ensureTextFile(path, scaffold);
  await openTextFile(path);
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Hooman", {
    log: true,
  });
  context.subscriptions.push(outputChannel);

  const permissions = new PermissionPrompts(outputChannel);
  context.subscriptions.push(permissions);

  const client = new HoomanAcpClient(outputChannel, permissions);
  context.subscriptions.push(client);

  const editTracker = new EditTracker();
  client.fs.setEditTracker(editTracker);
  context.subscriptions.push(
    editTracker,
    vscode.workspace.registerTextDocumentContentProvider(
      BASELINE_SCHEME,
      editTracker,
    ),
  );

  const chatView = new HoomanChatViewProvider(
    context,
    context.extensionUri,
    client,
    permissions,
    editTracker,
    outputChannel,
  );
  context.subscriptions.push(chatView);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      HoomanChatViewProvider.viewType,
      chatView,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  const planEditor = new PlanEditorProvider(context, chatView);
  const configEditor = new HoomanConfigEditorProvider(context);
  const mcpEditor = new HoomanMcpEditorProvider(context);
  const skillsPanel = new HoomanSkillsPanel(context);
  context.subscriptions.push(
    planEditor,
    configEditor,
    mcpEditor,
    skillsPanel,
    vscode.window.registerCustomEditorProvider(
      PlanEditorProvider.viewType,
      planEditor,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
    vscode.window.registerCustomEditorProvider(
      HoomanConfigEditorProvider.viewType,
      configEditor,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
    vscode.window.registerCustomEditorProvider(
      HoomanMcpEditorProvider.viewType,
      mcpEditor,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooman.newChat", () => {
      chatView.newChat();
      chatView.focus();
    }),
    vscode.commands.registerCommand("hooman.pickSession", () => {
      chatView.showSessions();
    }),
    vscode.commands.registerCommand("hooman.openConfig", async () => {
      const action = await pickLauncherAction();
      switch (action) {
        case "open-config":
          await openConfigurationSurface(configEditor);
          return;
        case "open-mcp":
          await openMcpSurface(mcpEditor);
          return;
        case "open-instructions":
          await openInstructions();
          return;
        case "open-skills":
          await skillsPanel.show();
          return;
        case "open-raw-config":
          await openRaw(homeConfigPath(), defaultConfigScaffold(true));
          return;
        case "open-raw-mcp":
          await openRaw(homeMcpPath(), defaultMcpScaffold());
          return;
        default:
          return;
      }
    }),
    vscode.commands.registerCommand(
      "hooman.addExplorerSelectionToChat",
      async (uri?: vscode.Uri, uris?: readonly vscode.Uri[]) => {
        const selection = coerceExplorerUris(uri, uris);
        if (selection.length === 0) {
          void vscode.window.showWarningMessage(
            "Hooman: no files or folders selected.",
          );
          return;
        }
        await chatView.addExplorerAttachments(selection);
        void vscode.window.setStatusBarMessage(
          `Hooman: added ${describeExplorerSelection(selection)} to chat`,
          3000,
        );
      },
    ),
    vscode.commands.registerCommand(
      "hooman.addExplorerSelectionToNewChat",
      async (uri?: vscode.Uri, uris?: readonly vscode.Uri[]) => {
        const selection = coerceExplorerUris(uri, uris);
        if (selection.length === 0) {
          void vscode.window.showWarningMessage(
            "Hooman: no files or folders selected.",
          );
          return;
        }
        await chatView.addExplorerAttachments(selection, { newChat: true });
        void vscode.window.setStatusBarMessage(
          `Hooman: started a new chat with ${describeExplorerSelection(selection)}`,
          3000,
        );
      },
    ),
    vscode.commands.registerCommand("hooman.addSelectionToChat", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showWarningMessage("Hooman: no text selected.");
        return;
      }
      chatView.addSelectionAttachment(editor);
    }),
    vscode.commands.registerCommand("hooman.addSelectionToNewChat", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showWarningMessage("Hooman: no text selected.");
        return;
      }
      chatView.addSelectionAttachment(editor, { newChat: true });
    }),
    vscode.languages.registerCodeLensProvider(
      { pattern: "**/*" },
      new SelectionActionsCodeLensProvider(context),
    ),
  );

  const statusBar = new HoomanStatusBar({
    setConfigOption: (configId, value, isBoolean) =>
      chatView.setConfigOption(configId, value, isBoolean),
    newChat: () => chatView.newChat(),
    pickSession: () => chatView.showSessions(),
    showOutput: () => outputChannel.show(),
    focusChat: () => chatView.focus(),
    openConfig: () => void vscode.commands.executeCommand("hooman.openConfig"),
  });
  chatView.setStatusBar(statusBar);

  const planFileActions = new PlanFileActions(
    chatView,
    editTracker,
    planEditor,
  );
  context.subscriptions.push(
    planFileActions,
    statusBar,
    vscode.commands.registerCommand(HoomanStatusBar.menuCommand, () => {
      void statusBar.showMenu();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooman.showOutput", () => {
      outputChannel.show();
    }),
    vscode.commands.registerCommand("hooman.plan.pickModel", () =>
      planFileActions.pickModel(),
    ),
    vscode.commands.registerCommand("hooman.plan.build", () =>
      planFileActions.buildActivePlan(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooman.deleteAllSessions", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Delete all Hooman chat sessions? This cannot be undone.",
        { modal: true },
        "Delete all",
      );
      if (confirm !== "Delete all") {
        return;
      }
      try {
        const agent = await client.ensureStarted();
        const response = await agent.request(methods.agent.session.list, {});
        for (const info of response.sessions) {
          await agent.request(methods.agent.session.delete, {
            sessionId: info.sessionId,
          });
        }
      } catch (error) {
        outputChannel.error(
          `[extension] failed to delete sessions: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (isHoomanConfigPath(document.uri.fsPath)) {
        await openHoomanConfigEditor(configEditor, document.uri, {
          preserveFocus: false,
          viewColumn: vscode.ViewColumn.Active,
        });
        return;
      }
      if (isHoomanMcpPath(document.uri.fsPath)) {
        await openHoomanMcpEditor(mcpEditor, document.uri, {
          preserveFocus: false,
          viewColumn: vscode.ViewColumn.Active,
        });
      }
    }),
  );
}

function coerceExplorerUris(
  uri: vscode.Uri | undefined,
  uris: readonly vscode.Uri[] | undefined,
): vscode.Uri[] {
  const seen = new Set<string>();
  const files: vscode.Uri[] = [];
  for (const candidate of [uri, ...(uris ?? [])]) {
    if (!candidate || candidate.scheme !== "file") {
      continue;
    }
    const key = candidate.toString();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    files.push(candidate);
  }
  return files;
}

function describeExplorerSelection(uris: readonly vscode.Uri[]): string {
  if (uris.length === 0) {
    return "selection";
  }
  if (uris.length === 1) {
    return `“${basename(uris[0].fsPath) || uris[0].fsPath}”`;
  }
  return `${uris.length} items`;
}

export function deactivate(): void {}
