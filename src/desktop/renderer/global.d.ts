import type {
  PromptContentBlock,
  SessionConfigOption,
} from "../shared/session-types.js";

export type HoomanNotificationPayload = {
  projectId: string;
  method: string;
  params: {
    sessionId: string;
    update: import("../shared/session-types.js").SessionUpdate;
  };
};

export type HoomanPermissionRequestPayload = {
  requestId: string;
  projectId: string;
  sessionId: string;
  options: Array<{ optionId: string; name: string }>;
};

export type HoomanSessionSummary = {
  sessionId: string;
  title?: string;
  updatedAt: string;
};

export type SkillInstalledEntry = {
  name: string;
  description?: string;
  folder: string;
};

export type SkillSearchResult = {
  name: string;
  slug: string;
  source: string;
  installs: number;
};

/** Redacted-secrets shape returned by the management RPC's `config/get`. */
export type ManagementProvider = {
  name: string;
  provider: string;
  options?: Record<string, unknown>;
};

export type ManagementLlm = {
  name: string;
  provider: string;
  options: {
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    context?: number;
  };
  metadata?: Record<string, unknown> | null;
  default: boolean;
};

export type ManagementConfig = {
  name: string;
  providers: ManagementProvider[];
  llms: ManagementLlm[];
  search: {
    enabled?: boolean;
    provider?: string;
    [providerName: string]: unknown;
  };
  prompts: {
    behaviour?: boolean;
    communication?: boolean;
    execution?: boolean;
    guardrails?: boolean;
  };
  tools: Record<string, { enabled?: boolean } | undefined>;
  compaction: { ratio?: number; keep?: number };
  reasoning?: "collapsed" | "full";
  daemon: {
    sessions?: { max?: number; timeout?: number };
    mcproxy?: { port?: number };
  };
};

export type HoomanBridge = {
  getSetupStatus: () => Promise<{ configured: boolean }>;
  getManagementSummary: () => Promise<{
    config: ManagementConfig | null;
    mcpServers: Array<{
      name: string;
      transport: {
        type?: string;
        command?: string;
        args?: string[];
        url?: string;
      };
      sourcePath: string;
      scope: "global" | "project";
    }>;
    skills: SkillInstalledEntry[];
  }>;
  upsertMcpServer: (
    name: string,
    transport: {
      type?: "stdio" | "streamable-http" | "sse";
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    },
  ) => Promise<{ ok: true }>;
  deleteMcpServer: (name: string) => Promise<{ ok: true }>;
  upsertProvider: (
    name: string,
    provider: string,
    options?: Record<string, unknown>,
  ) => Promise<{ ok: true }>;
  deleteProvider: (name: string) => Promise<{ ok: true }>;
  upsertLlm: (llm: {
    name: string;
    provider: string;
    options: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
    default?: boolean;
  }) => Promise<{ ok: true }>;
  deleteLlm: (name: string) => Promise<{ ok: true }>;
  saveGeneral: (general: {
    name?: string;
    reasoning?: "collapsed" | "full";
    compaction?: { ratio?: number; keep?: number };
  }) => Promise<{ ok: true }>;
  setPromptToggle: (key: string, value: boolean) => Promise<{ ok: true }>;
  setToolToggle: (key: string, value: boolean) => Promise<{ ok: true }>;
  saveSearch: (search: {
    enabled?: boolean;
    provider?: string;
    apiKey?: string;
    baseURL?: string;
    tool?: string;
  }) => Promise<{ ok: true }>;
  openConfigFile: () => Promise<string>;
  openMcpFile: () => Promise<string>;
  openSkillsFolder: () => Promise<string>;
  searchSkills: (query: string) => Promise<SkillSearchResult[]>;
  installSkill: (source: string) => Promise<{ ok: true }>;
  deleteSkill: (folder: string) => Promise<{ ok: true }>;
  getDefaultCwd: () => Promise<{ cwd: string }>;
  chooseProject: () => Promise<string | null>;
  openProject: (cwd: string) => Promise<{ projectId: string; cwd: string }>;
  closeProject: (projectId: string) => Promise<void>;
  listSessions: (
    projectId: string,
  ) => Promise<{ sessions: HoomanSessionSummary[] }>;
  newSession: (
    projectId: string,
  ) => Promise<{ sessionId: string; configOptions: SessionConfigOption[] }>;
  openSession: (
    projectId: string,
    sessionId: string,
  ) => Promise<{ configOptions: SessionConfigOption[] }>;
  closeSession: (projectId: string, sessionId: string) => Promise<void>;
  deleteSession: (projectId: string, sessionId: string) => Promise<void>;
  prompt: (
    projectId: string,
    sessionId: string,
    prompt: PromptContentBlock[],
  ) => Promise<void>;
  cancel: (projectId: string, sessionId: string) => Promise<void>;
  stopShellJob: (
    projectId: string,
    sessionId: string,
    jobId: string,
  ) => Promise<{ stopped: boolean }>;
  pickFiles: () => Promise<
    Array<{
      uri: string;
      name: string;
      kind: "file" | "directory";
      size?: number;
    }>
  >;
  writeFile: (
    projectId: string,
    path: string,
    content: string | null,
  ) => Promise<void>;
  setConfigOption: (
    projectId: string,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ) => Promise<{ configOptions: SessionConfigOption[] }>;
  respondToPermission: (requestId: string, optionId: string) => void;
  onNotification: (
    callback: (payload: HoomanNotificationPayload) => void,
  ) => () => void;
  onPermissionRequest: (
    callback: (payload: HoomanPermissionRequestPayload) => void,
  ) => () => void;
};

declare global {
  interface Window {
    hooman: HoomanBridge;
  }
}
