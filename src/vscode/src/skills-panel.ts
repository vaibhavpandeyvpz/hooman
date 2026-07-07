import { basename, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { OutboundMessage } from "./shared/protocol";
import type {
  SkillInstalledEntryInfo,
  SkillSearchResultInfo,
  SkillsViewAction,
  SkillsViewStateInfo,
} from "./shared/settings";
import { homeSkillsPath } from "./settings-utils";

const execFileAsync = promisify(execFile);
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";
const SKILLS_CLI = "skills@latest";
const SKILLS_AGENT = "openclaw";
const SKILLS_API_URL = "https://skills.sh";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function parseSkillFrontmatter(
  content: string,
  dirName: string,
): {
  name: string;
  description?: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const block = match?.[1] ?? "";
  const lines = block.split(/\r?\n/);
  const values = new Map<string, string>();
  for (const line of lines) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) continue;
    values.set(keyValue[1]!, keyValue[2]!.trim().replace(/^['"]|['"]$/g, ""));
  }
  return {
    name: values.get("name")?.trim() || dirName,
    description: values.get("description")?.trim() || undefined,
  };
}

async function runNpxSkills(
  args: string[],
  cwd: string,
  timeout = 300_000,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(NPX_BIN, ["--yes", SKILLS_CLI, ...args], {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    timeout,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

async function listInstalledSkills(): Promise<SkillInstalledEntryInfo[]> {
  const cwd = resolve(homeSkillsPath(), "..");
  const result = await runNpxSkills(
    ["list", "--json", "-a", SKILLS_AGENT],
    cwd,
  );
  const rows = JSON.parse(result.stdout.trim() || "[]") as Array<{
    name: string;
    path: string;
  }>;
  const items: SkillInstalledEntryInfo[] = [];
  for (const row of rows) {
    try {
      const root = resolve(cwd, row.path);
      const skillPath = join(root, "SKILL.md");
      const raw = await readFile(skillPath, "utf8");
      const folder = basename(root);
      const meta = parseSkillFrontmatter(raw, folder);
      items.push({
        name: meta.name,
        description: meta.description,
        path: skillPath,
        folder,
      });
    } catch {
      continue;
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function searchSkills(query: string): Promise<SkillSearchResultInfo[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    return [];
  }
  const url = `${SKILLS_API_URL}/api/search?q=${encodeURIComponent(trimmed)}&limit=10`;
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as {
    skills?: Array<{
      skillId: string;
      name: string;
      installs: number;
      source: string;
    }>;
  };
  return (data.skills ?? [])
    .map((skill) => ({
      name: skill.name,
      slug: `${skill.source.trim()}@${skill.skillId.trim()}`,
      source: skill.source || "",
      installs: skill.installs,
    }))
    .sort((a, b) => b.installs - a.installs);
}

export class HoomanSkillsPanel implements vscode.Disposable {
  static readonly viewType = "hooman.skillsPanel";

  readonly #context: vscode.ExtensionContext;
  #panel: vscode.WebviewPanel | undefined;
  #state: SkillsViewStateInfo = {
    homePath: homeSkillsPath(),
    installed: [],
    query: "",
    results: [],
    searched: false,
    busy: false,
  };

  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
  }

  dispose(): void {
    this.#panel?.dispose();
    this.#panel = undefined;
  }

  async show(): Promise<void> {
    if (this.#panel) {
      this.#panel.reveal(vscode.ViewColumn.Active, false);
      await this.#refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      HoomanSkillsPanel.viewType,
      "Hooman Skills",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.#context.extensionUri, "media"),
        ],
      },
    );
    this.#panel = panel;
    panel.webview.html = this.#html(panel.webview);
    panel.onDidDispose(() => {
      this.#panel = undefined;
    });
    panel.webview.onDidReceiveMessage(
      (message: { type: string; action?: SkillsViewAction }) => {
        void this.#onMessage(message.action);
      },
    );
    await this.#refresh();
  }

  async #onMessage(action: SkillsViewAction | undefined): Promise<void> {
    if (!action) return;
    try {
      switch (action.type) {
        case "refresh":
          await this.#refresh();
          return;
        case "search": {
          const query = action.query.trim();
          this.#state.query = query;
          this.#state.searched = query.length >= 2;
          if (query.length < 2) {
            this.#state.results = [];
            this.#state.busy = false;
            this.#state.busyMessage = undefined;
            await this.#postState();
            return;
          }
          await this.#withBusy(`Searching “${query}”…`, async () => {
            this.#state.results = await searchSkills(query);
          });
          return;
        }
        case "installSource":
          await this.#withBusy(`Installing ${action.source}…`, async () => {
            await runNpxSkills(
              ["add", action.source.trim(), "-y", "-a", SKILLS_AGENT, "--copy"],
              resolve(homeSkillsPath(), ".."),
              600_000,
            );
            await this.#refresh();
          });
          return;
        case "installSearchResult":
          await this.#withBusy(`Installing ${action.name}…`, async () => {
            await runNpxSkills(
              ["add", action.slug, "-y", "-a", SKILLS_AGENT, "--copy"],
              resolve(homeSkillsPath(), ".."),
              600_000,
            );
            await this.#refresh();
          });
          return;
        case "remove":
          await this.#withBusy(`Removing ${action.displayName}…`, async () => {
            await runNpxSkills(
              ["remove", action.folder, "-y"],
              resolve(homeSkillsPath(), ".."),
            );
            await this.#refresh();
          });
          return;
        case "openSkill":
          await vscode.window.showTextDocument(vscode.Uri.file(action.path), {
            preview: false,
          });
          return;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Hooman: ${error instanceof Error ? stripAnsi(error.message) : String(error)}`,
      );
      await this.#postState();
    }
  }

  async #withBusy(message: string, fn: () => Promise<void>): Promise<void> {
    this.#state.busy = true;
    this.#state.busyMessage = message;
    await this.#postState();
    try {
      await fn();
    } finally {
      this.#state.busy = false;
      this.#state.busyMessage = undefined;
      await this.#postState();
    }
  }

  async #refresh(): Promise<void> {
    await this.#withBusy("Refreshing skills…", async () => {
      this.#state.installed = await listInstalledSkills();
    });
  }

  async #postState(): Promise<void> {
    if (!this.#panel) return;
    await this.#panel.webview.postMessage({
      type: "route",
      route: "/skills",
    } satisfies OutboundMessage);
    await this.#panel.webview.postMessage({
      type: "skillsViewState",
      state: this.#state,
    } satisfies OutboundMessage);
  }

  #html(webview: vscode.Webview): string {
    const mediaRoot = vscode.Uri.joinPath(this.#context.extensionUri, "media");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.js"),
    );
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Hooman Skills</title>
</head>
<body data-route="/skills">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
