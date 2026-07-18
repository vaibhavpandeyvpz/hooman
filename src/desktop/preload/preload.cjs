"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Narrow, typed bridge. The renderer never receives `ipcRenderer`, `require`,
 * or any Node/Electron object — only these specific operations, validated
 * again against Zod schemas on the main-process side.
 */
contextBridge.exposeInMainWorld("hooman", {
  getSetupStatus: () => ipcRenderer.invoke("hooman:setup-status"),
  getManagementSummary: () => ipcRenderer.invoke("hooman:management-summary"),
  upsertMcpServer: (name, transport) =>
    ipcRenderer.invoke("hooman:mcp-upsert", { name, transport }),
  deleteMcpServer: (name) => ipcRenderer.invoke("hooman:mcp-delete", { name }),
  upsertProvider: (name, provider, options) =>
    ipcRenderer.invoke("hooman:provider-upsert", { name, provider, options }),
  deleteProvider: (name) =>
    ipcRenderer.invoke("hooman:provider-delete", { name }),
  upsertLlm: (llm) => ipcRenderer.invoke("hooman:llm-upsert", llm),
  deleteLlm: (name) => ipcRenderer.invoke("hooman:llm-delete", { name }),
  saveGeneral: (general) => ipcRenderer.invoke("hooman:general-save", general),
  setPromptToggle: (key, value) =>
    ipcRenderer.invoke("hooman:prompt-toggle", { key, value }),
  setToolToggle: (key, value) =>
    ipcRenderer.invoke("hooman:tool-toggle", { key, value }),
  saveSearch: (search) => ipcRenderer.invoke("hooman:search-save", search),
  openConfigFile: () => ipcRenderer.invoke("hooman:open-config-file"),
  openMcpFile: () => ipcRenderer.invoke("hooman:open-mcp-file"),
  openSkillsFolder: () => ipcRenderer.invoke("hooman:open-skills-folder"),
  searchSkills: (query) =>
    ipcRenderer.invoke("hooman:skills-search", { query }),
  installSkill: (source) =>
    ipcRenderer.invoke("hooman:skills-install", { source }),
  deleteSkill: (folder) =>
    ipcRenderer.invoke("hooman:skills-delete", { folder }),
  getDefaultCwd: () => ipcRenderer.invoke("hooman:get-default-cwd"),
  chooseProject: () => ipcRenderer.invoke("hooman:choose-project"),
  openProject: (cwd) => ipcRenderer.invoke("hooman:open-project", { cwd }),
  closeProject: (projectId) =>
    ipcRenderer.invoke("hooman:close-project", { projectId }),
  listSessions: (projectId) =>
    ipcRenderer.invoke("hooman:list-sessions", { projectId }),
  newSession: (projectId) =>
    ipcRenderer.invoke("hooman:new-session", { projectId }),
  openSession: (projectId, sessionId) =>
    ipcRenderer.invoke("hooman:open-session", { projectId, sessionId }),
  closeSession: (projectId, sessionId) =>
    ipcRenderer.invoke("hooman:close-session", { projectId, sessionId }),
  deleteSession: (projectId, sessionId) =>
    ipcRenderer.invoke("hooman:delete-session", { projectId, sessionId }),
  prompt: (projectId, sessionId, prompt) =>
    ipcRenderer.invoke("hooman:prompt", { projectId, sessionId, prompt }),
  cancel: (projectId, sessionId) =>
    ipcRenderer.invoke("hooman:cancel", { projectId, sessionId }),
  stopShellJob: (projectId, sessionId, jobId) =>
    ipcRenderer.invoke("hooman:stop-shell-job", {
      projectId,
      sessionId,
      jobId,
    }),
  pickFiles: () => ipcRenderer.invoke("hooman:pick-files"),
  writeFile: (projectId, path, content) =>
    ipcRenderer.invoke("hooman:write-file", { projectId, path, content }),
  setConfigOption: (projectId, sessionId, configId, value) =>
    ipcRenderer.invoke("hooman:set-config-option", {
      projectId,
      sessionId,
      configId,
      value,
    }),
  respondToPermission: (requestId, optionId) =>
    ipcRenderer.send("hooman:permission-respond", requestId, optionId),
  onNotification: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("hooman:acp-notification", listener);
    return () =>
      ipcRenderer.removeListener("hooman:acp-notification", listener);
  },
  onPermissionRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("hooman:permission-request", listener);
    return () =>
      ipcRenderer.removeListener("hooman:permission-request", listener);
  },
});
