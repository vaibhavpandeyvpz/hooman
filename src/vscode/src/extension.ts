import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { methods } from "@agentclientprotocol/sdk";
import { HoomanAcpClient } from "./acp-client";
import { HoomanChatViewProvider } from "./chat-view";
import { BASELINE_SCHEME, EditTracker } from "./edit-tracker";
import { PermissionPrompts } from "./permissions";
import { HoomanStatusBar } from "./status-bar";

/** `~/.hooman/` (or `$HOOMAN_HOME`); mirrors `src/core/utils/paths.ts`. */
function hoomanHomePath(): string {
  const override = process.env.HOOMAN_HOME?.trim();
  return override || join(homedir(), ".hooman");
}

type HoomanSettingsFile = {
  /** File name under the Hooman home directory. */
  file: string;
  label: string;
  description: string;
  /** Written only when the file doesn't already exist. */
  scaffold: string;
};

const HOOMAN_SETTINGS_FILES: readonly HoomanSettingsFile[] = [
  {
    file: "config.json",
    label: "$(json) config.json",
    description: "App config — providers, models, tool toggles, compaction",
    scaffold: "{}\n",
  },
  {
    file: "mcp.json",
    label: "$(plug) mcp.json",
    description: "Configured MCP servers",
    scaffold: '{\n  "mcpServers": {}\n}\n',
  },
];

/** Open a Hooman settings file in an editor, scaffolding it first if it doesn't exist yet. */
async function openHoomanSettingsFile(
  settingsFile: HoomanSettingsFile,
): Promise<void> {
  const path = join(hoomanHomePath(), settingsFile.file);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, settingsFile.scaffold, { flag: "wx" });
  } catch {
    // Directory/file already exists — fine, we just open it below.
  }
  try {
    const document = await vscode.workspace.openTextDocument(path);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Hooman: failed to open ${settingsFile.file}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Prompt for which Hooman settings file to open (`config.json` or `mcp.json`), then open it. */
async function pickAndOpenSettings(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    HOOMAN_SETTINGS_FILES.map((settingsFile) => ({
      label: settingsFile.label,
      description: settingsFile.description,
      settingsFile,
    })),
    { placeHolder: "Which Hooman settings file do you want to open?" },
  );
  if (picked) {
    await openHoomanSettingsFile(picked.settingsFile);
  }
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

  // Edit tracker: snapshots baselines for files the agent writes through the
  // ACP fs backend, powering the Changes panel (diff / keep / undo).
  const editTracker = new EditTracker();
  client.fs.setEditTracker(editTracker);
  context.subscriptions.push(
    editTracker,
    vscode.workspace.registerTextDocumentContentProvider(
      BASELINE_SCHEME,
      editTracker,
    ),
  );

  // Webview chat panel — works everywhere (stable VS Code, Insiders, and compatible forks).
  const chatView = new HoomanChatViewProvider(
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
  context.subscriptions.push(
    vscode.commands.registerCommand("hooman.newChat", () => {
      chatView.newChat();
      chatView.focus();
    }),
    vscode.commands.registerCommand("hooman.pickSession", () => {
      chatView.showSessions();
    }),
    vscode.commands.registerCommand("hooman.openConfig", () =>
      pickAndOpenSettings(),
    ),
  );

  // Status bar item mirroring the panel's session (model · mode, spinner while
  // busy); its menu exposes all session controls.
  const statusBar = new HoomanStatusBar({
    setConfigOption: (configId, value, isBoolean) =>
      chatView.setConfigOption(configId, value, isBoolean),
    newChat: () => chatView.newChat(),
    pickSession: () => chatView.showSessions(),
    showOutput: () => outputChannel.show(),
    focusChat: () => chatView.focus(),
    openConfig: () => void pickAndOpenSettings(),
  });
  chatView.setStatusBar(statusBar);
  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand(HoomanStatusBar.menuCommand, () => {
      void statusBar.showMenu();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooman.showOutput", () => {
      outputChannel.show();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooman.deleteAllSessions", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Delete all Hooman chat sessions? This cannot be undone.",
        { modal: true },
        "Delete All",
      );
      if (confirm !== "Delete All") {
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
}

export function deactivate(): void {}
