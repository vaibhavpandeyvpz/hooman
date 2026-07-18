import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { AcpLaunchSpec } from "../acp-client/index.js";
import { ProjectRegistry } from "./project-registry.js";
import { ManagementClient } from "./management-client.js";
import { getDefaultCwd, setLastProject } from "./last-project.js";
import {
  cancelRequest,
  generalSaveRequest,
  llmDeleteRequest,
  llmUpsertRequest,
  mcpDeleteRequest,
  mcpUpsertRequest,
  openProjectRequest,
  projectOnlyRequest,
  projectSessionRequest,
  promptRequest,
  promptToggleRequest,
  providerDeleteRequest,
  providerUpsertRequest,
  searchSaveRequest,
  setConfigOptionRequest,
  skillsDeleteRequest,
  skillsInstallRequest,
  skillsSearchRequest,
  stopShellJobRequest,
  toolToggleRequest,
  writeFileRequest,
} from "../shared/ipc-contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * Dev: `src/desktop/resources/runtime` (staged next to source).
 * Packaged: `<app>/Contents/Resources/runtime` via electron-builder's
 * `extraResources`, at `process.resourcesPath` — never inside the ASAR
 * archive, since the staged Node binary and native modules must execute
 * from real filesystem paths.
 */
const STAGED_RUNTIME_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "runtime")
  : path.join(__dirname, "..", "..", "resources", "runtime");
const stagedNodeBin = path.join(
  STAGED_RUNTIME_DIR,
  process.platform === "win32" ? "node.exe" : "node",
);
const stagedCliEntry = path.join(STAGED_RUNTIME_DIR, "app", "dist", "cli.js");
const hasStagedRuntime =
  existsSync(stagedNodeBin) && existsSync(stagedCliEntry);

/**
 * Uses the staged runtime (`scripts/stage-runtime.mjs`: a copied Node 24
 * binary + the compiled app + a production-only dependency closure) when
 * present — this is the packaged/production path. Falls back to the repo's
 * dev `tsx` runner only when no staged runtime exists (i.e. `npm run
 * desktop:dev` without having run `stage-runtime` first).
 */
function launchSpec(
  subcommand: "acp" | "management",
  cwd: string,
): AcpLaunchSpec {
  if (hasStagedRuntime) {
    return {
      command: stagedNodeBin,
      args: [stagedCliEntry, subcommand],
      cwd,
      env: {
        HOME: process.env["HOME"],
        HOOMAN_HOME: process.env["HOOMAN_HOME"],
        // Needed to resolve `npx`/`node`/etc. as subprocesses (MCP stdio
        // servers, the shell tool, and the skills registry's `npx skills`
        // calls) — carries no secrets, unlike inheriting the full host env.
        PATH: process.env["PATH"],
      },
    };
  }
  const tsx = path.join(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  return {
    command: tsx,
    args: [path.join(REPO_ROOT, "src", "cli.ts"), subcommand],
    cwd,
    env: {
      ...process.env,
      HOOMAN_X_VSCODE: undefined,
      NODE_OPTIONS: undefined,
    },
  };
}

let mainWindow: BrowserWindow | null = null;
const pendingPermissions = new Map<string, (optionId: string) => void>();
const sessionUnsubscribers = new Map<string, () => void>();

const registry = new ProjectRegistry(
  (cwd) => launchSpec("acp", cwd),
  (projectId, params) => {
    return new Promise<string>((resolve) => {
      const requestId = randomUUID();
      pendingPermissions.set(requestId, resolve);
      mainWindow?.webContents.send("hooman:permission-request", {
        requestId,
        projectId,
        ...params,
      });
    });
  },
);

/** One global management process (config/MCP/skills are home-scoped, not per-project). */
const management = new ManagementClient(launchSpec("management", REPO_ROOT));

function subscribeIfNeeded(projectId: string, sessionId: string): void {
  const key = `${projectId}:${sessionId}`;
  if (sessionUnsubscribers.has(key)) return;
  const unsubscribe = registry.subscribe(
    projectId,
    sessionId,
    (notification) => {
      mainWindow?.webContents.send("hooman:acp-notification", {
        projectId,
        method: "session/update",
        params: notification,
      });
    },
  );
  sessionUnsubscribers.set(key, unsubscribe);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0b1120",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devServerUrl = process.env["HOOMAN_DESKTOP_DEV_SERVER_URL"];
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  // Model output can contain links; never open a new BrowserWindow or
  // navigate the app itself to them — hand https/http off to the OS browser
  // and deny everything else (plan §6: "disable or limit creation of new
  // windows"; "allow external HTTPS links only after URL parsing").
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
}

function isSafeExternalUrl(url: string): boolean {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("hooman:setup-status", () => management.setupStatus());

  ipcMain.handle("hooman:management-summary", async () => ({
    config: await management.getConfig(),
    mcpServers: await management.listMcpServers(),
    skills: await management.listSkills(),
  }));

  ipcMain.handle("hooman:mcp-upsert", async (_event, rawRequest) => {
    const { name, transport } = mcpUpsertRequest.parse(rawRequest);
    return management.upsertMcpServer(name, transport);
  });

  ipcMain.handle("hooman:mcp-delete", async (_event, rawRequest) => {
    const { name } = mcpDeleteRequest.parse(rawRequest);
    return management.deleteMcpServer(name);
  });

  ipcMain.handle("hooman:provider-upsert", async (_event, rawRequest) => {
    const { name, provider, options } = providerUpsertRequest.parse(rawRequest);
    return management.upsertProvider({ name, provider, options });
  });

  ipcMain.handle("hooman:provider-delete", async (_event, rawRequest) => {
    const { name } = providerDeleteRequest.parse(rawRequest);
    return management.deleteProvider(name);
  });

  ipcMain.handle("hooman:llm-upsert", async (_event, rawRequest) => {
    const {
      name,
      provider,
      options,
      metadata,
      default: isDefault,
    } = llmUpsertRequest.parse(rawRequest);
    return management.upsertLlm({
      name,
      provider,
      options,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(isDefault !== undefined ? { default: isDefault } : {}),
    });
  });

  ipcMain.handle("hooman:llm-delete", async (_event, rawRequest) => {
    const { name } = llmDeleteRequest.parse(rawRequest);
    return management.deleteLlm(name);
  });

  ipcMain.handle("hooman:general-save", async (_event, rawRequest) => {
    return management.saveGeneral(generalSaveRequest.parse(rawRequest));
  });

  ipcMain.handle("hooman:prompt-toggle", async (_event, rawRequest) => {
    const { key, value } = promptToggleRequest.parse(rawRequest);
    return management.setPromptToggle(key, value);
  });

  ipcMain.handle("hooman:tool-toggle", async (_event, rawRequest) => {
    const { key, value } = toolToggleRequest.parse(rawRequest);
    return management.setToolToggle(key, value);
  });

  ipcMain.handle("hooman:search-save", async (_event, rawRequest) => {
    return management.saveSearch(searchSaveRequest.parse(rawRequest));
  });

  ipcMain.handle("hooman:open-config-file", async () => {
    const paths = await management.getPaths();
    return shell.openPath(paths.config);
  });

  ipcMain.handle("hooman:open-mcp-file", async () => {
    const paths = await management.getPaths();
    return shell.openPath(paths.mcp);
  });

  ipcMain.handle("hooman:open-skills-folder", async () => {
    const paths = await management.getPaths();
    return shell.openPath(paths.skills);
  });

  ipcMain.handle("hooman:skills-search", async (_event, rawRequest) => {
    const { query } = skillsSearchRequest.parse(rawRequest);
    return management.searchSkills(query);
  });

  ipcMain.handle("hooman:skills-install", async (_event, rawRequest) => {
    const { source } = skillsInstallRequest.parse(rawRequest);
    return management.installSkill(source);
  });

  ipcMain.handle("hooman:skills-delete", async (_event, rawRequest) => {
    const { folder } = skillsDeleteRequest.parse(rawRequest);
    return management.deleteSkill(folder);
  });

  ipcMain.handle("hooman:get-default-cwd", async () => ({
    cwd: await getDefaultCwd(),
  }));

  ipcMain.handle("hooman:choose-project", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("hooman:open-project", async (_event, rawRequest) => {
    const { cwd } = openProjectRequest.parse(rawRequest);
    const project = await registry.openProject(cwd);
    void setLastProject(project.cwd);
    return { projectId: project.id, cwd: project.cwd };
  });

  ipcMain.handle("hooman:close-project", async (_event, rawRequest) => {
    const { projectId } = projectOnlyRequest.parse(rawRequest);
    const prefix = `${projectId}:`;
    for (const key of [...sessionUnsubscribers.keys()]) {
      if (!key.startsWith(prefix)) continue;
      sessionUnsubscribers.get(key)?.();
      sessionUnsubscribers.delete(key);
    }
    registry.closeProject(projectId);
  });

  ipcMain.handle("hooman:list-sessions", async (_event, rawRequest) => {
    const { projectId } = projectOnlyRequest.parse(rawRequest);
    return registry.listSessions(projectId);
  });

  ipcMain.handle("hooman:new-session", async (_event, rawRequest) => {
    const { projectId } = projectOnlyRequest.parse(rawRequest);
    const { sessionId, configOptions } = await registry.newSession(projectId);
    subscribeIfNeeded(projectId, sessionId);
    return { sessionId, configOptions: configOptions ?? [] };
  });

  ipcMain.handle("hooman:open-session", async (_event, rawRequest) => {
    const { projectId, sessionId } = projectSessionRequest.parse(rawRequest);
    // Subscribe before `session/load` resolves: the agent replays the
    // session's conversation history as `session/update` notifications
    // *during* that request, ahead of its response, so subscribing
    // afterwards silently drops the whole history replay.
    subscribeIfNeeded(projectId, sessionId);
    const { configOptions } = await registry.loadSession(projectId, sessionId);
    return { configOptions: configOptions ?? [] };
  });

  ipcMain.handle("hooman:close-session", async (_event, rawRequest) => {
    const { projectId, sessionId } = projectSessionRequest.parse(rawRequest);
    sessionUnsubscribers.get(`${projectId}:${sessionId}`)?.();
    sessionUnsubscribers.delete(`${projectId}:${sessionId}`);
    await registry.closeSession(projectId, sessionId);
  });

  ipcMain.handle("hooman:delete-session", async (_event, rawRequest) => {
    const { projectId, sessionId } = projectSessionRequest.parse(rawRequest);
    sessionUnsubscribers.get(`${projectId}:${sessionId}`)?.();
    sessionUnsubscribers.delete(`${projectId}:${sessionId}`);
    await registry.deleteSession(projectId, sessionId);
  });

  ipcMain.handle("hooman:prompt", async (_event, rawRequest) => {
    const { projectId, sessionId, prompt } = promptRequest.parse(rawRequest);
    await registry.prompt(projectId, sessionId, prompt);
  });

  ipcMain.handle("hooman:cancel", async (_event, rawRequest) => {
    const { projectId, sessionId } = cancelRequest.parse(rawRequest);
    await registry.cancel(projectId, sessionId);
  });

  ipcMain.handle("hooman:stop-shell-job", async (_event, rawRequest) => {
    const { projectId, sessionId, jobId } =
      stopShellJobRequest.parse(rawRequest);
    return registry.stopShellJob(projectId, sessionId, jobId);
  });

  ipcMain.handle("hooman:pick-files", async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "openDirectory", "multiSelections"],
      title: "Attach files to the prompt",
    });
    if (result.canceled) return [];
    return Promise.all(
      result.filePaths.map(async (filePath) => {
        const info = await stat(filePath);
        return {
          uri: pathToFileURL(filePath).toString(),
          name: path.basename(filePath),
          kind: info.isDirectory() ? ("directory" as const) : ("file" as const),
          size: info.isDirectory() ? undefined : info.size,
        };
      }),
    );
  });

  // Write-back for the Changes panel's "undo" action: restores the
  // pre-edit baseline (or deletes a file the agent created). Only ever
  // targets paths this project's own tool calls already wrote to, but the
  // containment check still guards against an unexpectedly foreign path.
  ipcMain.handle("hooman:write-file", async (_event, rawRequest) => {
    const {
      projectId,
      path: targetPath,
      content,
    } = writeFileRequest.parse(rawRequest);
    const project = registry.get(projectId);
    if (!project) throw new Error(`Unknown project ${projectId}`);
    const canonicalTarget = existsSync(targetPath)
      ? await realpath(targetPath)
      : targetPath;
    const withinProject =
      canonicalTarget === project.cwd ||
      canonicalTarget.startsWith(`${project.cwd}${path.sep}`);
    if (!withinProject) {
      throw new Error(`Refusing to write outside the project: ${targetPath}`);
    }
    if (content === null) {
      await rm(canonicalTarget, { force: true });
    } else {
      await writeFile(canonicalTarget, content, "utf8");
    }
  });

  ipcMain.handle("hooman:set-config-option", async (_event, rawRequest) => {
    const { projectId, sessionId, configId, value } =
      setConfigOptionRequest.parse(rawRequest);
    return registry.setConfigOption(projectId, sessionId, configId, value);
  });

  ipcMain.on(
    "hooman:permission-respond",
    (_event, requestId: string, optionId: string) => {
      const resolve = pendingPermissions.get(requestId);
      if (!resolve) return;
      pendingPermissions.delete(requestId);
      resolve(optionId);
    },
  );
});

app.on("before-quit", () => {
  registry.stopAll();
  management.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
