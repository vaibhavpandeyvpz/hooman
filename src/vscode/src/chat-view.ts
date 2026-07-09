import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import {
  methods,
  type ContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
  type SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import type { HoomanAcpClient } from "./acp-client";
import type { EditTracker } from "./edit-tracker";
import type { PermissionPrompts } from "./permissions";
import { isPlanFilePath, openFile, openPlanFile } from "./plan-file";
import type { HoomanStatusBar } from "./status-bar";
import type {
  AttachmentInfo,
  CommandInfo,
  InboundMessage,
  OutboundMessage,
  QueuedPromptInfo,
  TabInfo,
} from "./shared/protocol";

/**
 * The Hooman chat panel: a plain webview view (activity bar) that talks ACP
 * through {@link HoomanAcpClient}. Unlike the native-chat surface, this works
 * in stable VS Code and forks — no proposed APIs, no special entitlement.
 *
 * The panel keeps multiple ACP sessions alive in parallel and switches
 * between them with tabs.
 */
type SessionHostState = {
  title: string;
  cwd: string;
  loaded: boolean;
  configOptions: SessionConfigOption[];
  commands: CommandInfo[];
  busy: boolean;
  queue: QueuedPromptInfo[];
  pendingPermissionCount: number;
  unread: boolean;
  pendingUpdates: SessionNotification[];
  pendingConfigOptions: Map<
    string,
    { value: string | boolean; boolean: boolean }
  >;
  liveTerminals: Map<string, NodeJS.Timeout>;
};

type PersistedTabState = {
  sessionId: string;
  cwd: string;
  title: string;
};

export class HoomanChatViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "hooman.chatView";
  static readonly maxOpenTabs = 8;

  #view: vscode.WebviewView | undefined;
  #webviewReady = false;
  #sessionId: string | null = null;
  #sessionTitle = "New Chat";
  #tabs: string[] = [];
  #sessions = new Map<string, SessionHostState>();
  /** Working directory of the active session, used to resolve relative Markdown links clicked in chat/plan text. */
  #cwd: string = defaultCwd();
  #configOptions: SessionConfigOption[] = [];
  #commands: CommandInfo[] = [];
  #busy = false;
  /**
   * Set for the duration of one `#prompt()` call, waiting for the agent's
   * own echo of the turn's `user_message_chunk` to arrive so we can capture
   * its ACP-generated `messageId` (see the MessageId RFD) as this turn's
   * identifier for {@link EditTracker.beginTurn} — only one turn can be
   * in-flight in this panel at a time, so a single slot suffices.
   */
  #pendingTurnStart: { sessionId: string } | null = null;
  #statusBar: HoomanStatusBar | undefined;
  /**
   * Prompts submitted while a turn was already running. Runs in FIFO order,
   * one turn at a time, after the active turn finishes — unless the user
   * explicitly "steers" them into the active turn instead (see `#steer`).
   */
  #queue: QueuedPromptInfo[] = [];
  /**
   * `session/new` can emit notifications (e.g. `available_commands_update`)
   * that reach this client before its JSON-RPC response does, i.e. before
   * `#sessionId` is assigned. Buffer anything that arrives while no session
   * is known yet and replay it once `#sessionId` is set, instead of silently
   * dropping it.
   */
  #pendingUpdates: SessionNotification[] = [];
  /**
   * Config picks (mode/model/effort) made while `session/new` was still in
   * flight. Keyed by configId so repeated picks keep only the latest value;
   * applied in order once the session exists.
   */
  #pendingConfigOptions = new Map<
    string,
    { value: string | boolean; boolean: boolean }
  >();
  /** Whether the webview's Sessions panel is open (gates live list refreshes). */
  #sessionsPanelOpen = false;
  #sessionsRefreshTimer: NodeJS.Timeout | undefined;
  /** Attachments staged before the webview was ready to receive messages. */
  #pendingComposerAttachments: AttachmentInfo[] = [];

  /**
   * Fired whenever the panel's session state may have changed: session
   * created/switched, busy toggled, title updated, config changed, or a
   * session deleted from the picker. The sessions view refreshes off this.
   */
  readonly #onDidChangeSessionState = new vscode.EventEmitter<void>();
  readonly onDidChangeSessionState = this.#onDidChangeSessionState.event;

  #pendingPermissions = new Map<
    string,
    {
      sessionId: string;
      resolve: (response: RequestPermissionResponse) => void;
    }
  >();
  /** toolCallId → poll timer streaming live terminal output to the webview. */
  #liveTerminals = new Map<string, NodeJS.Timeout>();
  readonly #disposables: vscode.Disposable[] = [];
  readonly #storageKey = "hooman.chatTabs";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly extensionUri: vscode.Uri,
    private readonly client: HoomanAcpClient,
    private readonly permissions: PermissionPrompts,
    private readonly editTracker: EditTracker,
    private readonly outputChannel: vscode.LogOutputChannel,
  ) {
    this.#restorePersistedTabs();
    this.permissions.setInlineDelegate((sessionKey, request, cancellation) =>
      this.#tryInlinePermission(sessionKey, request, cancellation),
    );
    this.#disposables.push(
      this.client.onSessionUpdate((notification) =>
        this.#onSessionUpdate(notification),
      ),
      this.client.onModelDownload((notification) => {
        const state = this.#sessions.get(notification.sessionId);
        if (state) {
          state.busy = state.busy || notification.status === "downloading";
        }
        const { sessionId, ...download } = notification;
        this.#post({
          type: "download",
          sessionId,
          download: download.status === "downloading" ? download : null,
        });
        this.#post({
          type: "tabs",
          tabs: this.#tabInfo(),
          activeSessionId: this.#sessionId,
        });
      }),
      this.client.onModelRetry((notification) => {
        const { sessionId, ...retry } = notification;
        this.#post({
          type: "retry",
          sessionId,
          retry: retry.status === "countdown" ? retry : null,
        });
      }),
      this.client.onDidExit(() => {
        this.#busy = false;
        this.#stopAllTerminalPolls();
        for (const state of this.#sessions.values()) {
          for (const timer of state.liveTerminals.values()) {
            clearInterval(timer);
          }
          state.liveTerminals.clear();
          state.busy = false;
          state.pendingUpdates = [];
          state.pendingConfigOptions.clear();
          state.queue = [];
        }
        const activeSessionId = this.#sessionId;
        this.#sessionId = null;
        this.#pendingUpdates = [];
        this.#pendingConfigOptions.clear();
        this.#queue = [];
        for (const pending of this.#pendingPermissions.values()) {
          const sessionState = this.#sessions.get(pending.sessionId);
          if (sessionState) {
            sessionState.pendingPermissionCount = Math.max(
              0,
              sessionState.pendingPermissionCount - 1,
            );
          }
        }
        this.#pendingPermissions.clear();
        if (activeSessionId) {
          this.#post({
            type: "sessionLoading",
            sessionId: activeSessionId,
            loading: false,
          });
          this.#post({
            type: "error",
            sessionId: activeSessionId,
            message: "The Hooman agent process exited.",
          });
        }
        this.#post({
          type: "tabs",
          tabs: this.#tabInfo(),
          activeSessionId: this.#sessionId,
        });
      }),
      this.editTracker.onDidChangeEdits((sessionId) => {
        if (sessionId === this.#sessionId) {
          this.#postEdits();
        }
      }),
    );
  }

  /** Attach the status bar that mirrors this panel's session state. */
  setStatusBar(statusBar: HoomanStatusBar): void {
    this.#statusBar = statusBar;
    this.#syncStatus();
  }

  #createSessionState(overrides?: Partial<SessionHostState>): SessionHostState {
    return {
      title: "New Chat",
      cwd: defaultCwd(),
      loaded: false,
      configOptions: [],
      commands: [],
      busy: false,
      queue: [],
      pendingPermissionCount: 0,
      unread: false,
      pendingUpdates: [],
      pendingConfigOptions: new Map(),
      liveTerminals: new Map(),
      ...overrides,
    };
  }

  #createPendingSessionId(): string {
    return `pending:${randomUUID()}`;
  }

  #isPendingSessionId(sessionId: string | null): sessionId is string {
    return Boolean(sessionId?.startsWith("pending:"));
  }

  #replaceSessionId(previousSessionId: string, nextSessionId: string): void {
    if (previousSessionId === nextSessionId) {
      return;
    }
    const state = this.#sessions.get(previousSessionId);
    if (!state) {
      return;
    }
    const existing = this.#sessions.get(nextSessionId);
    this.#sessions.delete(previousSessionId);
    this.#sessions.set(nextSessionId, existing ?? state);
    this.#tabs = this.#tabs.map((sessionId) =>
      sessionId === previousSessionId ? nextSessionId : sessionId,
    );
    if (this.#sessionId === previousSessionId) {
      this.#sessionId = nextSessionId;
    }
    for (const pending of this.#pendingPermissions.values()) {
      if (pending.sessionId === previousSessionId) {
        pending.sessionId = nextSessionId;
      }
    }
  }

  #persistTabs(): void {
    const tabs = this.#tabs
      .map((sessionId) => {
        const state = this.#sessions.get(sessionId);
        if (!state) {
          return null;
        }
        return {
          sessionId,
          cwd: state.cwd,
          title: state.title,
        } satisfies PersistedTabState;
      })
      .filter((tab): tab is PersistedTabState => tab !== null);
    void this.context.workspaceState.update(this.#storageKey, {
      tabs,
      activeSessionId: this.#sessionId,
    });
  }

  #restorePersistedTabs(): void {
    const saved = this.context.workspaceState.get<{
      tabs?: PersistedTabState[];
      activeSessionId?: string | null;
    }>(this.#storageKey);
    if (!saved?.tabs?.length) {
      return;
    }
    this.#tabs = [];
    this.#sessions.clear();
    for (const tab of saved.tabs) {
      if (!tab.sessionId) {
        continue;
      }
      this.#tabs.push(tab.sessionId);
      this.#sessions.set(
        tab.sessionId,
        this.#createSessionState({
          title: tab.title || tab.sessionId,
          cwd: tab.cwd || defaultCwd(),
          loaded: false,
        }),
      );
    }
    const active =
      saved.activeSessionId && this.#sessions.has(saved.activeSessionId)
        ? saved.activeSessionId
        : (this.#tabs[0] ?? null);
    if (active) {
      this.#loadSessionState(active);
    }
  }

  async #ensureSessionLoaded(sessionId: string): Promise<void> {
    if (this.#isPendingSessionId(sessionId)) {
      return;
    }
    const state = this.#sessions.get(sessionId);
    if (!state || state.loaded) {
      return;
    }
    this.#saveActiveSessionState();
    this.#loadSessionState(sessionId);
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: sessionId,
    });
    this.#post({
      type: "sessionLoading",
      sessionId,
      loading: true,
      title: state.title,
    });
    this.#post({ type: "clear", sessionId });
    this.#postQueue();
    try {
      const agent = await this.client.ensureStarted();
      const response = await agent.request(methods.agent.session.load, {
        sessionId,
        cwd: state.cwd,
        mcpServers: [],
        _meta: { "hoomanjs/vscode": true },
      });
      state.loaded = true;
      state.configOptions = response.configOptions ?? [];
      if (this.#sessionId === sessionId) {
        this.#configOptions = [...state.configOptions];
      }
      this.#post({
        type: "configOptions",
        sessionId,
        configOptions: state.configOptions,
      });
      this.#postEdits();
      this.#syncStatus();
    } catch (error) {
      this.#post({
        type: "error",
        sessionId,
        message: `Failed to load session: ${describe(error)}`,
      });
    } finally {
      this.#post({ type: "sessionLoading", sessionId, loading: false });
      this.#post({
        type: "tabs",
        tabs: this.#tabInfo(),
        activeSessionId: this.#sessionId,
      });
      this.#persistTabs();
    }
  }

  #tabInfo(): TabInfo[] {
    return this.#tabs.map((sessionId) => {
      const state = this.#sessions.get(sessionId);
      return {
        sessionId,
        title: state?.title ?? sessionId,
        busy: state?.busy ?? false,
        loading: !(state?.loaded ?? true),
        pendingPermissions: state?.pendingPermissionCount ?? 0,
        unread: state?.unread ?? false,
      };
    });
  }

  #saveActiveSessionState(): void {
    if (!this.#sessionId) {
      return;
    }
    const existing = this.#sessions.get(this.#sessionId);
    if (!existing) {
      return;
    }
    existing.title = this.#sessionTitle;
    existing.cwd = this.#cwd;
    existing.configOptions = [...this.#configOptions];
    existing.commands = [...this.#commands];
    existing.busy = this.#busy;
    existing.queue = [...this.#queue];
    existing.pendingUpdates = [...this.#pendingUpdates];
    existing.pendingConfigOptions = new Map(this.#pendingConfigOptions);
    existing.liveTerminals = this.#liveTerminals;
  }

  #canOpenAnotherTab(): boolean {
    return this.#tabs.length < HoomanChatViewProvider.maxOpenTabs;
  }

  #warnTabLimit(): void {
    void vscode.window.showWarningMessage(
      `Hooman: you can open up to ${HoomanChatViewProvider.maxOpenTabs} chat tabs at once. Close one before opening another.`,
    );
  }

  #loadSessionState(sessionId: string): void {
    const state = this.#sessions.get(sessionId) ?? this.#createSessionState();
    this.#sessionId = sessionId;
    this.#sessionTitle = state.title;
    this.#cwd = state.cwd;
    this.#configOptions = [...state.configOptions];
    this.#commands = [...state.commands];
    this.#busy = state.busy;
    this.#queue = [...state.queue];
    this.#pendingUpdates = [...state.pendingUpdates];
    this.#pendingConfigOptions = new Map(state.pendingConfigOptions);
    this.#liveTerminals = state.liveTerminals;
    if (this.#view) {
      this.#view.title = this.#sessionTitle;
    }
  }

  #activateTab(sessionId: string): void {
    if (sessionId === this.#sessionId) {
      this.focus();
      return;
    }
    this.#saveActiveSessionState();
    const target = this.#sessions.get(sessionId);
    if (target) {
      target.unread = false;
    }
    this.#loadSessionState(sessionId);
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: this.#sessionId,
    });
    this.#postActiveState();
    this.#postEdits();
    this.#postQueue();
    this.#flushPendingComposerAttachments();
    this.#syncStatus();
    this.focus();
    const state = this.#sessions.get(sessionId);
    if (state && !state.loaded && !this.#isPendingSessionId(sessionId)) {
      void this.#ensureSessionLoaded(sessionId);
    }
  }

  #postActiveState(): void {
    if (!this.#sessionId) {
      return;
    }
    const active = this.#sessions.get(this.#sessionId);
    if (active) {
      active.unread = false;
    }
    this.#post({
      type: "state",
      sessionId: this.#sessionId,
      configOptions: this.#configOptions,
      commands: this.#commands,
      busy: this.#busy,
      queue: this.#queue,
    });
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: this.#sessionId,
    });
    this.#persistTabs();
  }

  /** Session currently active in the panel, if any. */
  get currentSessionId(): string | null {
    return this.#sessionId;
  }

  /** Whether the active tab currently has a turn running. */
  get isBusy(): boolean {
    return this.#busy;
  }

  /** Current session config options exposed by ACP for the active tab. */
  get configOptions(): readonly SessionConfigOption[] {
    return this.#configOptions;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.#view = webviewView;
    this.#webviewReady = false;
    webviewView.title = this.#sessionTitle;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.#html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: InboundMessage) => {
      void this.#onMessage(message);
    });
    webviewView.onDidDispose(() => {
      this.#view = undefined;
      this.#webviewReady = false;
    });
  }

  /** Bring the chat panel into view. */
  focus(): void {
    if (this.#view) {
      this.#view.show?.(false);
    } else {
      void vscode.commands.executeCommand("hooman.chatView.focus");
    }
  }

  /** Start a fresh session in a new tab, showing it immediately while ACP bootstraps in the background. */
  newChat(): void {
    if (!this.#canOpenAnotherTab()) {
      this.#warnTabLimit();
      return;
    }
    this.#saveActiveSessionState();
    const sessionId = this.#createPendingSessionId();
    this.#sessionId = sessionId;
    this.#sessionTitle = "New Chat";
    this.#cwd = defaultCwd();
    this.#pendingUpdates = [];
    this.#pendingConfigOptions = new Map();
    this.#configOptions = [];
    this.#commands = [];
    this.#busy = false;
    this.#queue = [];
    this.#liveTerminals = new Map();
    this.#sessions.set(
      sessionId,
      this.#createSessionState({
        title: this.#sessionTitle,
        cwd: this.#cwd,
        loaded: false,
      }),
    );
    this.#tabs.push(sessionId);
    if (this.#view) {
      this.#view.title = this.#sessionTitle;
    }
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: sessionId,
    });
    this.#postActiveState();
    this.#postEdits();
    this.#postQueue();
    this.#post({
      type: "sessionLoading",
      sessionId,
      loading: true,
      title: this.#sessionTitle,
    });
    this.#persistTabs();
    this.#syncStatus();
    void this.#ensureSession(sessionId).catch((error) => {
      this.outputChannel.warn(
        `[chat-view] eager session creation failed: ${describe(error)}`,
      );
    });
  }

  /** Stage files/folders from the Explorer as composer attachments. */
  async addExplorerAttachments(
    uris: readonly vscode.Uri[],
    options?: { newChat?: boolean },
  ): Promise<void> {
    const attachments = await this.#resolveUriAttachments(
      uris.map((uri) => uri.toString()),
    );
    this.#stageComposerAttachments(attachments, options);
  }

  /** Stage an active editor's selection as a ranged composer attachment. */
  addSelectionAttachment(
    editor: vscode.TextEditor,
    options?: { newChat?: boolean },
  ): void {
    const selection = editor.selection;
    if (selection.isEmpty) {
      return;
    }
    const start = selection.start.line + 1;
    const end = selection.end.line + 1;
    const path = editor.document.uri.fsPath;
    this.#stageComposerAttachments(
      [
        {
          id: randomUUID(),
          name: `${basename(path)} (${start}-${end})`,
          kind: "file",
          path,
          range: { start, end },
        },
      ],
      options,
    );
  }

  #stageComposerAttachments(
    attachments: AttachmentInfo[],
    options?: { newChat?: boolean },
  ): void {
    if (attachments.length === 0) {
      return;
    }
    if (options?.newChat) {
      this.#pendingComposerAttachments = attachments;
      this.newChat();
    } else {
      this.#pendingComposerAttachments.push(...attachments);
    }
    this.focus();
    this.#flushPendingComposerAttachments();
  }

  /** Change a session config option (used by the status bar menu and the webview pickers). */
  async setConfigOption(
    configId: string,
    value: string | boolean,
    isBoolean: boolean,
  ): Promise<void> {
    await this.#setConfigOption({
      type: "setConfigOption",
      configId,
      value,
      boolean: isBoolean,
    });
  }

  /** Submit a prompt from host-side UI integrations. */
  submitPrompt(text: string): void {
    this.#submitOrQueue(text, []);
    this.focus();
  }

  /** Open an existing ACP session in a tab, replaying its history once when first opened. */
  async openSession(
    sessionId: string,
    cwd: string,
    title: string,
  ): Promise<void> {
    if (this.#sessions.has(sessionId)) {
      this.#activateTab(sessionId);
      return;
    }
    if (!this.#canOpenAnotherTab()) {
      this.#warnTabLimit();
      return;
    }
    this.#saveActiveSessionState();
    const loadingState = this.#createSessionState({
      title,
      cwd,
      loaded: false,
    });
    this.#sessions.set(sessionId, loadingState);
    this.#tabs.push(sessionId);
    this.#loadSessionState(sessionId);
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: sessionId,
    });
    this.#postActiveState();
    this.#persistTabs();
    void this.#ensureSessionLoaded(sessionId);
  }

  /**
   * Open the custom-rendered Sessions panel inside the webview (an overlay):
   * grouped list of persisted sessions with the ongoing one marked
   * (spinner while a turn runs), click-to-open, and per-row delete.
   */
  showSessions(): void {
    this.focus();
    this.#sessionsPanelOpen = true;
    this.#post({ type: "showSessions" });
    void this.#postSessions();
  }

  /** Fetch the persisted session list and push it to the webview panel. */
  async #postSessions(): Promise<void> {
    try {
      const agent = await this.client.ensureStarted();
      const response = await agent.request(methods.agent.session.list, {});
      this.#post({
        type: "sessions",
        sessions: response.sessions.map((info) => {
          const current = info.sessionId === this.#sessionId;
          const state = this.#sessions.get(info.sessionId);
          return {
            sessionId: info.sessionId,
            cwd: info.cwd,
            title: info.title ?? info.sessionId,
            updatedAt: info.updatedAt ?? undefined,
            current,
            busy: state?.busy ?? false,
          };
        }),
      });
    } catch (error) {
      this.outputChannel.warn(
        `[chat-view] failed to list sessions: ${describe(error)}`,
      );
    }
  }

  /** Debounced live refresh of the Sessions panel while it's open. */
  #scheduleSessionsRefresh(): void {
    if (!this.#sessionsPanelOpen) {
      return;
    }
    if (this.#sessionsRefreshTimer) {
      clearTimeout(this.#sessionsRefreshTimer);
    }
    this.#sessionsRefreshTimer = setTimeout(() => {
      this.#sessionsRefreshTimer = undefined;
      void this.#postSessions();
    }, 250);
  }

  dispose(): void {
    this.#stopAllTerminalPolls();
    if (this.#sessionsRefreshTimer) {
      clearTimeout(this.#sessionsRefreshTimer);
    }
    this.#onDidChangeSessionState.dispose();
    this.permissions.setInlineDelegate(undefined);
    for (const pending of this.#pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.#pendingPermissions.clear();
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
  }

  // ---- Webview -> host ----------------------------------------------------

  async #onMessage(message: InboundMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.#webviewReady = true;
        this.#post({
          type: "tabs",
          tabs: this.#tabInfo(),
          activeSessionId: this.#sessionId,
        });
        if (this.#sessionId) {
          this.#postActiveState();
          this.#postEdits();
          const state = this.#sessions.get(this.#sessionId);
          if (state && !state.loaded) {
            if (this.#isPendingSessionId(this.#sessionId)) {
              void this.#ensureSession(this.#sessionId).catch((error) => {
                this.outputChannel.warn(
                  `[chat-view] eager session creation failed: ${describe(error)}`,
                );
              });
            } else {
              void this.#ensureSessionLoaded(this.#sessionId);
            }
          }
        } else {
          this.newChat();
        }
        this.#flushPendingComposerAttachments();
        return;
      case "prompt":
        this.#submitOrQueue(message.text, message.attachments ?? []);
        return;
      case "revert":
        await this.#revert(message.messageId);
        return;
      case "pickFiles":
        await this.#pickFiles();
        return;
      case "resolveDropped":
        await this.#resolveDropped(message.uris);
        return;
      case "openAttachment":
        await this.#openAttachment(message.attachment);
        return;
      case "openLink":
        await this.#openLink(message.href);
        return;
      case "cancel":
        await this.#cancel();
        return;
      case "setConfigOption":
        await this.#setConfigOption(message);
        return;
      case "permissionResponse": {
        const pending = this.#pendingPermissions.get(message.requestId);
        if (pending) {
          this.#pendingPermissions.delete(message.requestId);
          const sessionState = this.#sessions.get(pending.sessionId);
          if (sessionState) {
            sessionState.pendingPermissionCount = Math.max(
              0,
              sessionState.pendingPermissionCount - 1,
            );
          }
          pending.resolve({
            outcome: { outcome: "selected", optionId: message.optionId },
          });
          this.#post({
            type: "tabs",
            tabs: this.#tabInfo(),
            activeSessionId: this.#sessionId,
          });
          this.#post({
            type: "permissionResolved",
            sessionId: pending.sessionId,
            requestId: message.requestId,
            note: `Responded: ${message.optionId}`,
          });
        }
        return;
      }
      case "editAction":
        await this.#onEditAction(message);
        return;
      case "queueDelete":
        this.#queue = this.#queue.filter((item) => item.id !== message.id);
        this.#postQueue();
        return;
      case "queueSendNow": {
        const index = this.#queue.findIndex((item) => item.id === message.id);
        if (index === -1) {
          return;
        }
        const [item] = this.#queue.splice(index, 1);
        this.#postQueue();
        void this.#steerOrRun(item.text, item.attachments ?? []);
        return;
      }
      case "queueEdit": {
        const index = this.#queue.findIndex((item) => item.id === message.id);
        if (index === -1) {
          return;
        }
        const [item] = this.#queue.splice(index, 1);
        this.#postQueue();
        if (!this.#sessionId) {
          return;
        }
        this.#post({
          type: "queueEditText",
          sessionId: this.#sessionId,
          text: item.text,
          attachments: item.attachments,
        });
        return;
      }
      case "steerQueue":
        await this.#steerAllQueued();
        return;
      case "listSessions":
        this.#sessionsPanelOpen = true;
        await this.#postSessions();
        return;
      case "sessionsClosed":
        this.#sessionsPanelOpen = false;
        return;
      case "openSession":
        await this.openSession(message.sessionId, message.cwd, message.title);
        return;
      case "activateTab":
        this.#activateTab(message.sessionId);
        return;
      case "closeTab":
        await this.#closeTab(message.sessionId);
        return;
      case "deleteSession": {
        const deleted = await this.deleteSession(
          message.sessionId,
          message.title,
        );
        if (deleted) {
          await this.#postSessions();
        }
        return;
      }
      case "newChat":
        this.newChat();
        return;
      case "forkChat":
        await this.#forkChat();
        return;
    }
  }

  async #onEditAction(
    message: Extract<InboundMessage, { type: "editAction" }>,
  ): Promise<void> {
    if (!this.#sessionId) {
      return;
    }
    try {
      switch (message.action) {
        case "diff":
          if (message.path) {
            const uri = vscode.Uri.file(message.path);
            if (isPlanFilePath(uri.fsPath)) {
              await openPlanFile(uri);
              return;
            }
            // Falls back to opening the file when the edit is no longer
            // tracked (already kept/undone, or from an older session).
            const opened = await this.editTracker.openDiff(message.path);
            if (!opened) {
              await openFile(uri, { preview: false });
            }
          }
          return;
        case "keep":
          if (message.path) {
            this.editTracker.keep(message.path);
          }
          return;
        case "undo":
          if (message.path) {
            await this.editTracker.undo(message.path);
          }
          return;
        case "keepAll":
          this.editTracker.keepAll(this.#sessionId);
          return;
        case "undoAll":
          await this.editTracker.undoAll(this.#sessionId);
          return;
      }
    } catch (error) {
      if (this.#sessionId) {
        this.#post({
          type: "error",
          sessionId: this.#sessionId,
          message: `Edit action failed: ${describe(error)}`,
        });
      }
    }
  }

  async #forkChat(): Promise<void> {
    if (!this.#sessionId) {
      return;
    }
    const sourceSessionId = this.#sessionId;
    const sourceCwd = this.#cwd;
    const sourceTitle = this.#sessionTitle;
    const forkTitle = sourceTitle ? `${sourceTitle} (fork)` : "Fork Chat";
    const sourceState = this.#sessions.get(sourceSessionId);
    if (sourceState?.busy || this.#busy) {
      this.#post({
        type: "error",
        sessionId: sourceSessionId,
        message: "Finish the current turn before forking this chat.",
      });
      return;
    }
    try {
      const agent = await this.client.ensureStarted();
      const response = await agent.request(methods.agent.session.fork, {
        sessionId: sourceSessionId,
        cwd: sourceCwd,
        _meta: { "hoomanjs/vscode": true },
      });
      await this.openSession(response.sessionId, sourceCwd, forkTitle);
      await this.#postSessions();
    } catch (error) {
      this.#post({
        type: "error",
        sessionId: sourceSessionId,
        message: `Failed to fork session: ${describe(error)}`,
      });
    }
  }

  /**
   * Cursor-style revert: undo the file changes made from the turn whose
   * user message carries `messageId` onward (via
   * {@link EditTracker.revertToTurn}), and ask the agent to splice its
   * conversation history back to the same point. Per the ACP MessageId RFD,
   * `messageId` is generated by the agent itself (captured from the turn's
   * `user_message_chunk` echo — see `#pendingTurnStart`), not minted by this
   * client. The webview has already trimmed the transcript and restored the
   * composer optimistically; this only needs to reconcile the durable state.
   */
  async #revert(messageId: string): Promise<void> {
    const sessionId = this.#sessionId;
    if (!sessionId || this.#busy) {
      return;
    }
    // Confirm with the native modal, matching how close-tab/delete-session
    // gate their destructive actions. The webview holds off trimming the
    // transcript until we echo back a `reverted` message, so cancelling
    // here leaves the conversation untouched.
    const confirm = await vscode.window.showWarningMessage(
      "Revert to before this message?",
      {
        modal: true,
        detail:
          "This undoes the file changes made from this message onward and returns the message to the composer. This cannot be undone.",
      },
      "Revert",
    );
    if (confirm !== "Revert") {
      return;
    }
    if (this.#sessionId !== sessionId || this.#busy) {
      return;
    }
    try {
      await this.editTracker.revertToTurn(sessionId, messageId);
      this.#postEdits();
      const agent = await this.client.ensureStarted();
      await agent.request<
        { reverted: boolean },
        { sessionId: string; messageId: string }
      >("_hoomanjs/rewind_session", { sessionId, messageId });
      this.#post({ type: "reverted", sessionId, messageId });
    } catch (error) {
      this.#post({
        type: "error",
        sessionId,
        message: `Failed to revert: ${describe(error)}`,
      });
    }
  }

  /** Push the current pending-edit list for the active session to the webview. */
  #postEdits(): void {
    if (!this.#sessionId) {
      return;
    }
    this.#post({
      type: "edits",
      sessionId: this.#sessionId,
      edits: this.editTracker.listFor(this.#sessionId),
    });
  }

  /** Create the ACP session for a new-tab placeholder if one doesn't exist yet, without starting a turn. */
  async #ensureSession(sessionId = this.#sessionId): Promise<void> {
    if (!sessionId || !this.#isPendingSessionId(sessionId)) {
      return;
    }
    const placeholderState = this.#sessions.get(sessionId);
    if (!placeholderState) {
      return;
    }
    const agent = await this.client.ensureStarted();
    if (!this.#sessions.has(sessionId)) {
      return;
    }
    const response = await agent.request(methods.agent.session.new, {
      cwd: placeholderState.cwd,
      mcpServers: [],
      _meta: { "hoomanjs/vscode": true },
    });

    this.#adoptSession(
      sessionId,
      response.sessionId,
      response.configOptions ?? [],
    );
  }

  /** Assign the just-created ACP session to a visible placeholder tab and replay buffered notifications. */
  #adoptSession(
    placeholderSessionId: string,
    sessionId: string,
    configOptions: SessionConfigOption[],
  ): void {
    const state = this.#sessions.get(placeholderSessionId);
    if (!state) {
      return;
    }
    const pending = [...state.pendingUpdates, ...this.#pendingUpdates];
    state.loaded = true;
    state.configOptions = [...configOptions];
    state.pendingUpdates = [];
    this.#pendingUpdates = [];
    this.#replaceSessionId(placeholderSessionId, sessionId);
    if (this.#sessionId === sessionId) {
      this.#configOptions = [...configOptions];
      this.#sessionTitle = state.title;
      this.#cwd = state.cwd;
      this.#commands = [...state.commands];
      this.#busy = state.busy;
      this.#queue = [...state.queue];
      this.#pendingUpdates = [...state.pendingUpdates];
      this.#pendingConfigOptions = new Map(state.pendingConfigOptions);
      this.#liveTerminals = state.liveTerminals;
      if (this.#view) {
        this.#view.title = this.#sessionTitle;
      }
    }
    for (const notification of pending) {
      this.#deliverSessionUpdate({ ...notification, sessionId });
    }
    this.#post({ type: "clear", sessionId });
    this.#post({
      type: "sessionLoading",
      sessionId,
      loading: false,
    });
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: sessionId,
    });
    this.#post({
      type: "configOptions",
      sessionId,
      configOptions,
    });
    this.#postEdits();
    this.#postQueue();
    this.#flushPendingComposerAttachments();
    this.#persistTabs();
    this.#syncStatus();
    void this.#flushPendingConfigOptions();
  }

  /** Apply config picks that were made while session creation was in flight. */
  async #flushPendingConfigOptions(): Promise<void> {
    const pending = [...this.#pendingConfigOptions.entries()];
    this.#pendingConfigOptions.clear();
    if (this.#sessionId) {
      const state = this.#sessions.get(this.#sessionId);
      if (state) {
        state.pendingConfigOptions.clear();
      }
    }
    for (const [configId, pick] of pending) {
      await this.#setConfigOption({
        type: "setConfigOption",
        configId,
        value: pick.value,
        boolean: pick.boolean,
      });
    }
  }

  /**
   * `echoLocally` is needed for turns the webview never rendered optimistically
   * itself — i.e. anything that spent time sitting in the queue panel rather
   * than being typed straight into the composer.
   */
  async #prompt(
    text: string,
    attachments: AttachmentInfo[] = [],
    options?: { echoLocally?: boolean },
  ): Promise<void> {
    if (this.#busy) {
      return;
    }
    this.#busy = true;
    this.#saveActiveSessionState();
    this.#syncStatus();
    const promptSessionId = this.#sessionId;
    if (promptSessionId) {
      this.#post({ type: "promptStart", sessionId: promptSessionId });
      this.#post({
        type: "tabs",
        tabs: this.#tabInfo(),
        activeSessionId: this.#sessionId,
      });
      this.#pendingTurnStart = { sessionId: promptSessionId };
    }
    if (options?.echoLocally && promptSessionId) {
      this.#post({
        type: "update",
        sessionId: promptSessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          content: {
            type: "text",
            text: echoTextWithAttachments(text, attachments),
          },
          messageId: randomUUID(),
        },
      });
    }
    try {
      await this.#ensureSession(promptSessionId);
      const sessionId = this.#sessionId;
      if (!sessionId || this.#isPendingSessionId(sessionId)) {
        throw new Error("Session creation failed.");
      }
      const agent = await this.client.ensureStarted();
      const result = await agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: await this.#buildPromptBlocks(text, attachments),
      });
      this.#post({
        type: "promptEnd",
        sessionId,
        stopReason: result.stopReason,
      });
    } catch (error) {
      if (this.#sessionId) {
        this.#post({
          type: "error",
          sessionId: this.#sessionId,
          message: describe(error),
        });
      }
    } finally {
      this.#busy = false;
      this.#pendingTurnStart = null;
      this.#saveActiveSessionState();
      this.#postActiveState();
      this.#stopAllTerminalPolls();
      this.#syncStatus();
      this.#processNextQueued();
    }
  }

  async #cancel(): Promise<void> {
    const sessionId = this.#sessionId;
    if (!sessionId) {
      return;
    }
    // ACP cancellation: the client MUST respond to all pending
    // `session/request_permission` requests with the `cancelled` outcome as
    // soon as it sends `session/cancel`, rather than waiting for the agent to
    // cascade a `$/cancel_request` back.
    this.#cancelPendingPermissionsForSession(sessionId);
    try {
      const agent = await this.client.ensureStarted();
      await agent.notify(methods.agent.session.cancel, { sessionId });
    } catch (error) {
      this.outputChannel.warn(`[chat-view] cancel failed: ${describe(error)}`);
    }
  }

  /**
   * Free the agent's in-memory state for a session we're navigating away
   * from (`session/close`). Persisted data stays on disk, so it can still be
   * reopened later via `session/load`.
   */
  async #closeSession(sessionId: string): Promise<void> {
    try {
      const agent = await this.client.ensureStarted();
      await agent.request(methods.agent.session.close, { sessionId });
    } catch (error) {
      this.outputChannel.warn(
        `[chat-view] closing session ${sessionId} failed: ${describe(error)}`,
      );
    }
  }

  async #closeTab(sessionId: string): Promise<void> {
    const state = this.#sessions.get(sessionId);
    if (!state) {
      return;
    }
    if (state.pendingPermissionCount > 0) {
      const confirm = await vscode.window.showWarningMessage(
        `Close this tab with ${state.pendingPermissionCount} pending permission prompt${state.pendingPermissionCount === 1 ? "" : "s"}?`,
        {
          modal: true,
          detail:
            "Closing the tab will cancel those pending prompts for this session.",
        },
        "Close Tab",
      );
      if (confirm !== "Close Tab") {
        return;
      }
      this.#cancelPendingPermissionsForSession(sessionId);
    }
    for (const timer of state.liveTerminals.values()) {
      clearInterval(timer);
    }
    state.liveTerminals.clear();
    this.editTracker.clearTurns(sessionId);
    this.#sessions.delete(sessionId);
    this.#tabs = this.#tabs.filter((id) => id !== sessionId);
    const closedActive = this.#sessionId === sessionId;
    if (closedActive) {
      const next = this.#tabs[this.#tabs.length - 1] ?? null;
      if (next) {
        this.#loadSessionState(next);
        this.#postActiveState();
        this.#postEdits();
        this.#postQueue();
      } else {
        this.newChat();
      }
    }
    if (!closedActive || this.#tabs.length > 0) {
      this.#post({
        type: "tabs",
        tabs: this.#tabInfo(),
        activeSessionId: this.#sessionId,
      });
      this.#persistTabs();
      this.#syncStatus();
    }
    void this.#teardownClosedSession(sessionId, state.busy);
  }

  async #teardownClosedSession(
    sessionId: string,
    wasBusy: boolean,
  ): Promise<void> {
    if (!this.#isPendingSessionId(sessionId) && wasBusy) {
      try {
        const agent = await this.client.ensureStarted();
        await agent.notify(methods.agent.session.cancel, { sessionId });
      } catch (error) {
        this.outputChannel.warn(
          `[chat-view] cancel before close failed for ${sessionId}: ${describe(error)}`,
        );
      }
    }
    if (this.#isPendingSessionId(sessionId)) {
      return;
    }
    await this.#closeSession(sessionId);
  }

  /**
   * Delete one persisted session after a modal confirmation. Returns whether
   * the deletion happened. When it's the session currently open in the panel,
   * the panel resets to a fresh chat.
   */
  async deleteSession(sessionId: string, title: string): Promise<boolean> {
    const confirm = await vscode.window.showWarningMessage(
      `Delete the session "${title}"? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return false;
    }
    try {
      const agent = await this.client.ensureStarted();
      await agent.request(methods.agent.session.delete, { sessionId });
      if (this.#sessions.has(sessionId)) {
        await this.#closeTab(sessionId);
      } else {
        this.#persistTabs();
        this.#onDidChangeSessionState.fire();
      }
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Hooman: failed to delete session: ${describe(error)}`,
      );
      return false;
    }
  }

  // ---- Prompt queue & steering ---------------------------------------------

  /** Route a submitted prompt: start a turn immediately, or queue it if one is already running. */
  #submitOrQueue(text: string, attachments: AttachmentInfo[]): void {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) {
      return;
    }
    if (!this.#busy) {
      void this.#prompt(trimmed, attachments);
      return;
    }
    this.#queue.push({ id: randomUUID(), text: trimmed, attachments });
    this.#postQueue();
  }

  #postQueue(): void {
    if (!this.#sessionId) {
      return;
    }
    this.#post({
      type: "queue",
      sessionId: this.#sessionId,
      items: this.#queue,
    });
  }

  /** Dequeue and run the next queued prompt once the active turn ends. */
  #processNextQueued(): void {
    if (this.#busy || this.#queue.length === 0) {
      return;
    }
    const [next] = this.#queue.splice(0, 1);
    this.#postQueue();
    void this.#prompt(next.text, next.attachments ?? [], {
      echoLocally: true,
    });
  }

  /** For an individual "send now": steer if a turn is active, otherwise run it as a normal turn. */
  async #steerOrRun(
    text: string,
    attachments: AttachmentInfo[],
  ): Promise<void> {
    if (this.#busy) {
      await this.#steer(text, attachments);
    } else {
      void this.#prompt(text, attachments, { echoLocally: true });
    }
  }

  /** Drain the whole queue into the active turn's steering guidance in one shot. */
  async #steerAllQueued(): Promise<void> {
    if (!this.#busy || this.#queue.length === 0) {
      return;
    }
    const items = this.#queue;
    this.#queue = [];
    this.#postQueue();
    for (const item of items) {
      await this.#steer(item.text, item.attachments ?? []);
    }
  }

  /** Inject guidance into the currently running turn via `_meta["hoomanjs/steer"]`. */
  async #steer(
    text: string,
    attachments: AttachmentInfo[] = [],
  ): Promise<void> {
    if (!this.#sessionId) {
      return;
    }
    try {
      const agent = await this.client.ensureStarted();
      await agent.request(methods.agent.session.prompt, {
        sessionId: this.#sessionId,
        prompt: await this.#buildPromptBlocks(text, attachments),
        _meta: { "hoomanjs/steer": true },
      });
    } catch (error) {
      if (this.#sessionId) {
        this.#post({
          type: "error",
          sessionId: this.#sessionId,
          message: `Failed to steer the active turn: ${describe(error)}`,
        });
      }
    }
  }

  // ---- Attachments ----------------------------------------------------------

  /** Native file browser for the composer's paperclip button. */
  async #pickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      // Works on macOS; on Windows/Linux the dialog degrades to files-only.
      canSelectFolders: true,
      openLabel: "Attach",
      title: "Attach files to the prompt",
    });
    if (!uris?.length) {
      return;
    }
    await this.#resolveDropped(uris.map((uri) => uri.toString()));
  }

  /**
   * Resolve URIs (from the file dialog or a drop's `text/uri-list`) into
   * attachment descriptors — stat'ing to distinguish files from folders —
   * and hand them to the webview to stage as composer chips.
   */
  async #resolveDropped(uriStrings: string[]): Promise<void> {
    const attachments = await this.#resolveUriAttachments(uriStrings);
    if (attachments.length > 0) {
      if (this.#sessionId) {
        this.#post({
          type: "attachments",
          sessionId: this.#sessionId,
          attachments,
        });
      }
    }
  }

  async #resolveUriAttachments(
    uriStrings: string[],
  ): Promise<AttachmentInfo[]> {
    const attachments: AttachmentInfo[] = [];
    for (const raw of uriStrings) {
      try {
        const uri = vscode.Uri.parse(raw);
        if (uri.scheme !== "file") {
          continue;
        }
        const stat = await vscode.workspace.fs.stat(uri);
        const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
        const name = basename(uri.fsPath) || uri.fsPath;
        attachments.push({
          id: randomUUID(),
          name,
          kind: isDirectory
            ? "directory"
            : imageMimeFromPath(uri.fsPath)
              ? "image"
              : "file",
          path: uri.fsPath,
          mimeType: imageMimeFromPath(uri.fsPath) ?? undefined,
        });
      } catch (error) {
        this.outputChannel.warn(
          `[chat-view] could not resolve dropped uri ${raw}: ${describe(error)}`,
        );
      }
    }
    return attachments;
  }

  /**
   * Open a link clicked inside rendered Markdown (assistant messages, plan
   * bodies): `http(s)`/`mailto` URLs go to the OS's external handler,
   * everything else is treated as a filesystem path — absolute as-is,
   * relative resolved against the active session's cwd (falling back to the
   * first workspace folder) — and opened in an editor tab, or revealed in
   * the Explorer/OS file manager when it turns out to be a directory.
   */
  async #openLink(href: string): Promise<void> {
    try {
      const external =
        /^[a-z][a-z0-9+.-]*:\/\//i.test(href) || href.startsWith("mailto:");
      if (external) {
        // `vscode.open`-style URIs (vscode://, command:) are also better left
        // to the platform handler / VS Code's own URI dispatch.
        await vscode.env.openExternal(vscode.Uri.parse(href));
        return;
      }
      const clean = href.split(/[?#]/)[0] || href;
      const target = isAbsolute(clean)
        ? clean
        : join(
            this.#cwd ||
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
              defaultCwd(),
            clean,
          );
      const uri = vscode.Uri.file(target);
      let isDirectory = false;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
      } catch {
        // Doesn't exist on disk — fall through and let `vscode.open` surface
        // the error rather than silently doing nothing.
      }
      if (isDirectory) {
        try {
          await vscode.commands.executeCommand("revealInExplorer", uri);
        } catch {
          await vscode.commands.executeCommand("revealFileInOS", uri);
        }
        return;
      }
      await openFile(uri);
    } catch (error) {
      if (this.#sessionId) {
        this.#post({
          type: "error",
          sessionId: this.#sessionId,
          message: `Could not open ${href}: ${describe(error)}`,
        });
      }
    }
  }

  /**
   * Open/preview a clicked attachment chip: path-backed files open in an
   * editor tab (images in the built-in image preview), folders are revealed
   * in the Explorer, and pathless data (OS drops / pastes) is written to a
   * temp file first so there's something on disk to open.
   */
  async #openAttachment(attachment: AttachmentInfo): Promise<void> {
    try {
      if (attachment.path) {
        const uri = vscode.Uri.file(attachment.path);
        if (attachment.kind === "directory") {
          try {
            await vscode.commands.executeCommand("revealInExplorer", uri);
          } catch {
            // Folder lives outside the workspace — show it in the OS file manager.
            await vscode.commands.executeCommand("revealFileInOS", uri);
          }
          return;
        }
        await openFile(uri);
        return;
      }
      if (attachment.data) {
        const dir = join(tmpdir(), "hooman-attachments");
        await mkdir(dir, { recursive: true });
        const path = join(dir, `${attachment.id}-${basename(attachment.name)}`);
        await writeFile(path, Buffer.from(attachment.data, "base64"));
        await openFile(vscode.Uri.file(path));
      }
    } catch (error) {
      if (this.#sessionId) {
        this.#post({
          type: "error",
          sessionId: this.#sessionId,
          message: `Could not open ${attachment.name}: ${describe(error)}`,
        });
      }
    }
  }

  /**
   * Turn text + staged attachments into ACP prompt content blocks: images
   * become `image` blocks (reading path-backed ones from disk), files and
   * folders become `resource_link` blocks, and pathless non-image data
   * becomes an embedded blob `resource`.
   */
  async #buildPromptBlocks(
    text: string,
    attachments: AttachmentInfo[],
  ): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = [];
    if (text) {
      blocks.push({ type: "text", text });
    }
    for (const attachment of attachments) {
      try {
        blocks.push(await attachmentToBlock(attachment));
      } catch (error) {
        this.outputChannel.warn(
          `[chat-view] skipping attachment ${attachment.name}: ${describe(error)}`,
        );
      }
    }
    return blocks;
  }

  async #setConfigOption(
    message: Extract<InboundMessage, { type: "setConfigOption" }>,
  ): Promise<void> {
    if (!this.#sessionId || this.#isPendingSessionId(this.#sessionId)) {
      // Session creation is still in flight — remember the pick and apply it
      // once the session exists (see #adoptSession).
      this.#pendingConfigOptions.set(message.configId, {
        value: message.value,
        boolean: message.boolean ?? false,
      });
      return;
    }
    try {
      const agent = await this.client.ensureStarted();
      const request: SetSessionConfigOptionRequest = message.boolean
        ? {
            sessionId: this.#sessionId,
            configId: message.configId,
            type: "boolean",
            value: Boolean(message.value),
          }
        : {
            sessionId: this.#sessionId,
            configId: message.configId,
            value: String(message.value),
          };
      const response = await agent.request(
        methods.agent.session.setConfigOption,
        request,
      );
      this.#configOptions = response.configOptions ?? this.#configOptions;
      if (this.#sessionId) {
        const state = this.#sessions.get(this.#sessionId);
        if (state) {
          state.configOptions = [...this.#configOptions];
        }
        this.#post({
          type: "configOptions",
          sessionId: this.#sessionId,
          configOptions: this.#configOptions,
        });
      }
      this.#syncStatus();
    } catch (error) {
      if (this.#sessionId) {
        this.#post({
          type: "error",
          sessionId: this.#sessionId,
          message: `Failed to set option: ${describe(error)}`,
        });
      }
    }
  }

  // ---- Host -> webview ----------------------------------------------------

  #onSessionUpdate(notification: SessionNotification): void {
    const state = this.#sessions.get(notification.sessionId);
    if (!state) {
      if (this.#sessionId === null) {
        this.#pendingUpdates.push(notification);
      }
      return;
    }
    if (notification.sessionId === this.#sessionId) {
      this.#deliverSessionUpdate(notification);
      return;
    }
    this.#deliverSessionUpdate(notification, state);
  }

  #deliverSessionUpdate(
    notification: SessionNotification,
    stateOverride?: SessionHostState,
  ): void {
    const sessionId = notification.sessionId;
    const update = notification.update;
    const state = stateOverride ?? this.#sessions.get(sessionId);
    if (!state) {
      return;
    }
    if (sessionId !== this.#sessionId && this.#shouldMarkUnread(update)) {
      if (!state.unread) {
        state.unread = true;
        this.#post({
          type: "tabs",
          tabs: this.#tabInfo(),
          activeSessionId: this.#sessionId,
        });
      }
    }
    void this.#maybeRevealPlanFileFromUpdate(update);
    if (update.sessionUpdate === "config_option_update") {
      state.configOptions = update.configOptions ?? state.configOptions;
      if (sessionId === this.#sessionId) {
        this.#configOptions = [...state.configOptions];
      }
      this.#post({
        type: "configOptions",
        sessionId,
        configOptions: state.configOptions,
      });
      this.#syncStatus();
      return;
    }
    if (update.sessionUpdate === "available_commands_update") {
      state.commands = update.availableCommands ?? state.commands;
      if (sessionId === this.#sessionId) {
        this.#commands = [...state.commands];
      }
    }
    if (update.sessionUpdate === "session_info_update" && update.title) {
      state.title = update.title;
      if (sessionId === this.#sessionId) {
        this.#setTitle(update.title);
      } else {
        this.#post({
          type: "tabs",
          tabs: this.#tabInfo(),
          activeSessionId: this.#sessionId,
        });
      }
    }
    // During a live turn the agent echoes the prompt back as a
    // user_message_chunk; the webview already rendered it locally on send.
    // Only forward these during history replay (session/load) or when it's
    // a steered follow-up (which the webview never rendered locally).
    if (
      update.sessionUpdate === "user_message_chunk" &&
      this.#busy &&
      !update._meta?.["hoomanjs/steered"]
    ) {
      // This echo still carries the turn's authoritative `messageId` (see
      // the ACP MessageId RFD). Capture it for the turn `#prompt()` just
      // started so file-edit baselines and revert key off the agent's own
      // id instead of a client-minted one, then tell the webview which
      // already-rendered optimistic item it belongs to.
      const pending = this.#pendingTurnStart;
      if (pending && pending.sessionId === sessionId && update.messageId) {
        this.#pendingTurnStart = null;
        this.editTracker.beginTurn(sessionId, update.messageId);
        this.#post({
          type: "turnStarted",
          sessionId,
          messageId: update.messageId,
        });
      }
      return;
    }
    this.#trackLiveTerminal(sessionId, update);
    this.#post({
      type: "update",
      sessionId,
      update: this.#resolveToolContent(update),
    });
  }

  /**
   * Stream live terminal output: while a tool call embeds an unfinished
   * terminal, poll the captured output and push incremental tool_call_updates
   * so the webview shows the command's output as it runs (npm install, tests,
   * ...). The agent re-embeds the terminal in the completed/failed update,
   * which both stops the poll and delivers the final output.
   */
  #trackLiveTerminal(sessionId: string, update: SessionUpdate): void {
    if (
      update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update"
    ) {
      return;
    }
    if (update.status === "completed" || update.status === "failed") {
      this.#stopTerminalPoll(sessionId, update.toolCallId);
      return;
    }
    const terminal = update.content?.find((item) => item.type === "terminal");
    if (terminal) {
      this.#startTerminalPoll(
        sessionId,
        update.toolCallId,
        terminal.terminalId,
      );
    }
  }

  #startTerminalPoll(
    sessionId: string,
    toolCallId: string,
    terminalId: string,
  ): void {
    const state = this.#sessions.get(sessionId);
    if (!state || state.liveTerminals.has(toolCallId)) {
      return;
    }
    let lastOutput = "";
    const timer = setInterval(() => {
      const output = this.client.terminal.outputText(terminalId)?.trimEnd();
      if (!output || output === lastOutput) {
        return;
      }
      lastOutput = output;
      this.#post({
        type: "update",
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          _meta: { "hoomanjs/live": true },
          content: [
            { type: "content", content: { type: "text", text: output } },
          ],
        },
      });
    }, 300);
    state.liveTerminals.set(toolCallId, timer);
  }

  #stopTerminalPoll(sessionId: string, toolCallId: string): void {
    const state = this.#sessions.get(sessionId);
    const timer = state?.liveTerminals.get(toolCallId);
    if (timer) {
      clearInterval(timer);
      state?.liveTerminals.delete(toolCallId);
    }
  }

  #stopAllTerminalPolls(): void {
    for (const state of this.#sessions.values()) {
      for (const timer of state.liveTerminals.values()) {
        clearInterval(timer);
      }
      state.liveTerminals.clear();
    }
    for (const timer of this.#liveTerminals.values()) {
      clearInterval(timer);
    }
    this.#liveTerminals.clear();
  }

  /**
   * Shell tool results arrive as `{type: "terminal", terminalId}` content —
   * a reference to a terminal owned by this client. Resolve it to text so the
   * webview can render the captured output.
   */
  #resolveToolContent(update: SessionUpdate): SessionUpdate {
    if (
      (update.sessionUpdate !== "tool_call" &&
        update.sessionUpdate !== "tool_call_update") ||
      !update.content?.length
    ) {
      return update;
    }
    const content = update.content.map((item) => {
      if (item.type !== "terminal") {
        return item;
      }
      const output = this.client.terminal.outputText(item.terminalId);
      return {
        type: "content" as const,
        content: {
          type: "text" as const,
          text: output?.trimEnd() || "(no output)",
        },
      };
    });
    return { ...update, content };
  }

  #shouldMarkUnread(update: SessionUpdate): boolean {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk":
      case "tool_call":
      case "tool_call_update":
      case "session_info_update":
      case "plan":
        return true;
      case "user_message_chunk":
        return Boolean(update._meta?.["hoomanjs/steered"]);
      default:
        return false;
    }
  }

  #cancelPendingPermissionsForSession(sessionId: string): void {
    const entries = [...this.#pendingPermissions.entries()].filter(
      ([, pending]) => pending.sessionId === sessionId,
    );
    if (entries.length === 0) {
      return;
    }
    const sessionState = this.#sessions.get(sessionId);
    for (const [requestId, pending] of entries) {
      this.#pendingPermissions.delete(requestId);
      pending.resolve({ outcome: { outcome: "cancelled" } });
      this.#post({
        type: "permissionResolved",
        sessionId,
        requestId,
        note: "Cancelled",
      });
    }
    if (sessionState) {
      sessionState.pendingPermissionCount = Math.max(
        0,
        sessionState.pendingPermissionCount - entries.length,
      );
    }
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: this.#sessionId,
    });
  }

  #tryInlinePermission(
    sessionKey: string,
    request: RequestPermissionRequest,
    cancellation: vscode.CancellationToken,
  ): Promise<RequestPermissionResponse> | undefined {
    if (!this.#view || sessionKey !== this.#sessionId) {
      return undefined;
    }
    // Surface the panel so the user actually sees the prompt.
    this.#view.show?.(true);
    const requestId = randomUUID();
    const isQuestion = request._meta?.["hoomanjs/ask_user"] === true;
    const detail = request.toolCall.content
      ?.map((c) =>
        c.type === "content" && c.content.type === "text"
          ? c.content.text
          : undefined,
      )
      .find((text): text is string => Boolean(text));
    const sessionState = this.#sessions.get(sessionKey);
    if (sessionState) {
      sessionState.pendingPermissionCount += 1;
    }
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: this.#sessionId,
    });
    this.#post({
      type: "permission",
      sessionId: sessionKey,
      requestId,
      title: request.toolCall.title ?? "Tool call",
      detail: isQuestion
        ? detail
        : (detail ?? `Kind: ${request.toolCall.kind ?? "other"}`),
      options: request.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
      ...(isQuestion ? { question: true } : {}),
    });
    return new Promise<RequestPermissionResponse>((resolve) => {
      this.#pendingPermissions.set(requestId, {
        sessionId: sessionKey,
        resolve,
      });
      cancellation.onCancellationRequested(() => {
        if (this.#pendingPermissions.delete(requestId)) {
          const sessionState = this.#sessions.get(sessionKey);
          if (sessionState) {
            sessionState.pendingPermissionCount = Math.max(
              0,
              sessionState.pendingPermissionCount - 1,
            );
          }
          this.#post({
            type: "tabs",
            tabs: this.#tabInfo(),
            activeSessionId: this.#sessionId,
          });
          this.#post({
            type: "permissionResolved",
            sessionId: sessionKey,
            requestId,
            note: "Cancelled",
          });
          resolve({ outcome: { outcome: "cancelled" } });
        }
      });
    });
  }

  #post(message: OutboundMessage): void {
    void this.#view?.webview.postMessage(message);
  }

  async #maybeRevealPlanFileFromUpdate(update: SessionUpdate): Promise<void> {
    if (
      update.sessionUpdate !== "tool_call_update" ||
      update.status !== "completed"
    ) {
      return;
    }
    const planFile = findPlanFilePath(update.rawOutput);
    if (!planFile || !isPlanFilePath(planFile)) {
      return;
    }
    try {
      await openPlanFile(vscode.Uri.file(planFile));
    } catch (error) {
      this.outputChannel.warn(
        `[chat-view] failed to reveal plan file ${planFile}: ${describe(error)}`,
      );
    }
  }

  #flushPendingComposerAttachments(): void {
    if (
      !this.#webviewReady ||
      this.#pendingComposerAttachments.length === 0 ||
      !this.#sessionId
    ) {
      return;
    }
    const attachments = this.#pendingComposerAttachments;
    this.#pendingComposerAttachments = [];
    this.#post({
      type: "attachments",
      sessionId: this.#sessionId,
      attachments,
    });
  }

  /** Session title lives in the view header (not the composer) and the status bar tooltip. */
  #setTitle(title: string): void {
    this.#sessionTitle = title;
    if (this.#sessionId) {
      const state = this.#sessions.get(this.#sessionId);
      if (state) {
        state.title = title;
      }
    }
    if (this.#view) {
      this.#view.title = title;
    }
    this.#post({
      type: "tabs",
      tabs: this.#tabInfo(),
      activeSessionId: this.#sessionId,
    });
    this.#syncStatus();
  }

  #syncStatus(): void {
    this.#statusBar?.update({
      title: this.#sessionTitle,
      configOptions: this.#configOptions,
      busy: this.#busy,
    });
    this.#onDidChangeSessionState.fire();
    this.#scheduleSessionsRefresh();
  }

  #html(webview: vscode.Webview): string {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "chat.js"),
    );
    const nonce = randomUUID().replaceAll("-", "");
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Hooman</title>
</head>
<body data-route="/chat">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function defaultCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/** Raster-image MIME type for a path, or null when it isn't an attachable image. */
function imageMimeFromPath(path: string): string | null {
  return IMAGE_MIME_BY_EXT[extname(path).toLowerCase()] ?? null;
}

/** Convert one staged attachment into its ACP content block. */
async function attachmentToBlock(
  attachment: AttachmentInfo,
): Promise<ContentBlock> {
  if (attachment.kind === "image") {
    const data =
      attachment.data ??
      (attachment.path
        ? (await readFile(attachment.path)).toString("base64")
        : undefined);
    if (data) {
      return {
        type: "image",
        data,
        mimeType: attachment.mimeType ?? "image/png",
      };
    }
  }
  if (attachment.path) {
    const uri = vscode.Uri.file(attachment.path).toString();
    return {
      type: "resource_link",
      uri: attachment.range
        ? `${uri}#L${attachment.range.start}-L${attachment.range.end}`
        : uri,
      name: attachment.name,
    };
  }
  // Pathless non-image bytes (OS drop / paste): embed the payload directly.
  return {
    type: "resource",
    resource: {
      uri: `attachment:///${encodeURIComponent(attachment.name)}`,
      blob: attachment.data ?? "",
      mimeType: attachment.mimeType,
    },
  };
}

/** Text used when the host echoes a queued prompt into the transcript itself. */
function echoTextWithAttachments(
  text: string,
  attachments: AttachmentInfo[],
): string {
  if (attachments.length === 0) {
    return text;
  }
  const names = attachments
    .map((attachment) => `[attachment] ${attachment.name}`)
    .join("\n");
  return text ? `${text}\n\n${names}` : names;
}

function findPlanFilePath(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const planFile = findPlanFilePath(item);
      if (planFile) {
        return planFile;
      }
    }
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = record.plan_file;
  if (typeof direct === "string") {
    return direct;
  }
  for (const nested of Object.values(record)) {
    const planFile = findPlanFilePath(nested);
    if (planFile) {
      return planFile;
    }
  }
  return null;
}
