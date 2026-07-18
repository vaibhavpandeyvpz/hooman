import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  EMPTY_TRANSCRIPT,
  selectPendingEdits,
  type PromptContentBlock,
} from "../shared/session-reducer.js";
import type { HoomanPermissionRequestPayload } from "./global";
import { Transcript } from "./components/Transcript.js";
import { Composer } from "./components/Composer.js";
import { FolderSwitcher } from "./components/FolderSwitcher.js";
import { PermissionModal } from "./components/PermissionModal.js";
import { RightPanel } from "./components/RightPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { SettingsPanel } from "./components/settings/SettingsPanel.js";
import { Toaster } from "./components/ui/sonner.js";
import { appReducer, INITIAL_APP_STATE } from "./store.js";

export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [state, dispatch] = useReducer(appReducer, INITIAL_APP_STATE);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [promptStartedAt, setPromptStartedAt] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Bumped on every prompt submit so Transcript force-scrolls to the bottom
  // even if the user had scrolled up (session switches force-scroll off the
  // sessionId change itself, so they don't need a bump here).
  const [scrollToken, setScrollToken] = useState(0);
  const [permissionRequest, setPermissionRequest] =
    useState<HoomanPermissionRequestPayload | null>(null);
  const activatedSessions = useRef(new Set<string>());
  const bootstrapped = useRef(false);

  useEffect(() => {
    window.hooman
      .getSetupStatus()
      .then((status) => setConfigured(status.configured));
  }, []);

  useEffect(() => {
    return window.hooman.onNotification((payload) => {
      const { sessionId, update } = payload.params;
      dispatch({ type: "session-update", sessionId, update });
    });
  }, []);

  useEffect(() => {
    return window.hooman.onPermissionRequest((payload) =>
      setPermissionRequest(payload),
    );
  }, []);

  const activeSession =
    state.sessions.find((s) => s.sessionId === state.activeSessionId) ?? null;
  const activeProject = activeSession
    ? state.projects.find((p) => p.projectId === activeSession.projectId)
    : null;
  const transcript = state.activeSessionId
    ? (state.transcripts[state.activeSessionId] ?? EMPTY_TRANSCRIPT)
    : EMPTY_TRANSCRIPT;

  const startNewSession = useCallback(async (projectId: string) => {
    const { sessionId, configOptions } =
      await window.hooman.newSession(projectId);
    activatedSessions.current.add(sessionId);
    dispatch({
      type: "session-added",
      session: {
        sessionId,
        projectId,
        title: "New chat",
        updatedAt: new Date().toISOString(),
      },
    });
    if (configOptions.length > 0) {
      dispatch({
        type: "session-update",
        sessionId,
        update: { sessionUpdate: "config_option_update", configOptions },
      });
    }
  }, []);

  const selectSession = useCallback((projectId: string, sessionId: string) => {
    setShowSettings(false);
    if (!activatedSessions.current.has(sessionId)) {
      activatedSessions.current.add(sessionId);
      window.hooman
        .openSession(projectId, sessionId)
        .then(({ configOptions }) => {
          if (configOptions.length > 0) {
            dispatch({
              type: "session-update",
              sessionId,
              update: {
                sessionUpdate: "config_option_update",
                configOptions,
              },
            });
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
        });
    }
    dispatch({ type: "session-selected", sessionId });
  }, []);

  /**
   * Opens (or reuses) the ACP process for `cwd` and makes sure there is a
   * session to show for it. `selectExisting` picks the most recently used
   * session for this folder (`session/list` is sorted by `updatedAt` desc)
   * so the very first thing the user sees on launch is a live chat, not an
   * empty picker — set only for the automatic startup folder, not when the
   * user explicitly browses to a folder that already has other open chats.
   */
  const openFolder = useCallback(
    async (cwd: string, options?: { selectExisting?: boolean }) => {
      setStarting(true);
      setError(null);
      try {
        const project = await window.hooman.openProject(cwd);
        dispatch({ type: "project-opened", project });
        const { sessions } = await window.hooman.listSessions(
          project.projectId,
        );
        if (sessions.length > 0) {
          dispatch({
            type: "sessions-loaded",
            projectId: project.projectId,
            sessions,
          });
          if (options?.selectExisting)
            selectSession(project.projectId, sessions[0]!.sessionId);
        } else {
          await startNewSession(project.projectId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStarting(false);
      }
    },
    [startNewSession, selectSession],
  );

  const chooseFolder = useCallback(async () => {
    const cwd = await window.hooman.chooseProject();
    if (!cwd) return;
    await openFolder(cwd);
  }, [openFolder]);

  // Default to the last folder used in a previous run (else the user's home
  // directory) so a chat is ready immediately — no "open a folder first"
  // gate. The ref guard keeps this a single bootstrap even though
  // `StrictMode` double-invokes effects in development.
  useEffect(() => {
    if (configured !== true || bootstrapped.current) return;
    bootstrapped.current = true;
    void window.hooman
      .getDefaultCwd()
      .then(({ cwd }) => openFolder(cwd, { selectExisting: true }));
  }, [configured, openFolder]);

  const closeSession = useCallback(
    async (sessionId: string) => {
      const session = state.sessions.find((s) => s.sessionId === sessionId);
      if (!session) return;
      dispatch({ type: "session-removed", sessionId });
      try {
        await window.hooman.closeSession(session.projectId, sessionId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [state.sessions],
  );

  /**
   * Removes a folder from the sidebar for this run: stops its ACP process
   * on the main side and drops its projects/sessions from local state.
   * Non-destructive — session history stays on disk under that folder, so
   * reopening it later lists the same sessions again.
   */
  const closeProject = useCallback(async (projectId: string) => {
    dispatch({ type: "project-closed", projectId });
    try {
      await window.hooman.closeProject(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const send = useCallback(
    async (prompt: PromptContentBlock[]) => {
      if (!activeSession) return;
      // No optimistic local echo here: the ACP agent itself streams an
      // authoritative `user_message_chunk` for every prompt turn (see
      // `src/acp/prompt-invoke.ts` in the root package), so rendering our
      // own copy first would just create a duplicate bubble once the real
      // one arrives — this is a local child process, not a network call,
      // so the round trip is effectively instant.
      setSending(true);
      setPromptStartedAt(Date.now());
      setScrollToken((n) => n + 1);
      try {
        await window.hooman.prompt(
          activeSession.projectId,
          activeSession.sessionId,
          prompt,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
        setPromptStartedAt(null);
      }
    },
    [activeSession],
  );

  const cancel = useCallback(() => {
    if (!activeSession) return;
    void window.hooman.cancel(activeSession.projectId, activeSession.sessionId);
  }, [activeSession]);

  const stopShellJob = useCallback(
    (jobId: string) => {
      if (!activeSession) return;
      dispatch({
        type: "shell-job-stopping",
        sessionId: activeSession.sessionId,
        jobId,
      });
      void window.hooman.stopShellJob(
        activeSession.projectId,
        activeSession.sessionId,
        jobId,
      );
    },
    [activeSession],
  );

  /** Accept an edit as-is: the file already has the agent's content on disk, so this is purely local bookkeeping. */
  const keepEdit = useCallback(
    (path: string) => {
      if (!activeSession) return;
      dispatch({
        type: "edit-resolved",
        sessionId: activeSession.sessionId,
        path,
      });
    },
    [activeSession],
  );

  /** Revert an edit: restore its pre-edit baseline (or delete a file the agent created). */
  const undoEdit = useCallback(
    async (path: string) => {
      if (!activeSession) return;
      const edit = selectPendingEdits(transcript).find((e) => e.path === path);
      if (!edit) return;
      try {
        await window.hooman.writeFile(
          activeSession.projectId,
          path,
          edit.oldText,
        );
        dispatch({
          type: "edit-resolved",
          sessionId: activeSession.sessionId,
          path,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeSession, transcript],
  );

  const keepAllEdits = useCallback(() => {
    if (!activeSession) return;
    const paths = selectPendingEdits(transcript).map((e) => e.path);
    if (paths.length === 0) return;
    dispatch({
      type: "edits-resolved",
      sessionId: activeSession.sessionId,
      paths,
    });
  }, [activeSession, transcript]);

  const undoAllEdits = useCallback(async () => {
    if (!activeSession) return;
    const edits = selectPendingEdits(transcript);
    if (edits.length === 0) return;
    try {
      await Promise.all(
        edits.map((edit) =>
          window.hooman.writeFile(
            activeSession.projectId,
            edit.path,
            edit.oldText,
          ),
        ),
      );
      dispatch({
        type: "edits-resolved",
        sessionId: activeSession.sessionId,
        paths: edits.map((e) => e.path),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeSession, transcript]);

  const setConfigOption = useCallback(
    async (configId: string, value: string | boolean) => {
      if (!activeSession) return;
      try {
        const { configOptions } = await window.hooman.setConfigOption(
          activeSession.projectId,
          activeSession.sessionId,
          configId,
          value,
        );
        dispatch({
          type: "session-update",
          sessionId: activeSession.sessionId,
          update: { sessionUpdate: "config_option_update", configOptions },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeSession],
  );

  if (configured === null) {
    return (
      <div className="flex h-screen items-center justify-center text-hooman-muted text-[13px]">
        Loading…
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-lg font-medium">Hooman isn't set up yet</div>
        <p className="max-w-md text-[13px] text-hooman-muted">
          Run{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">
            hooman setup
          </code>{" "}
          from a terminal to configure a provider, then reopen Hooman Desktop. A
          guided in-app setup flow (Phase 5 of the desktop plan) will replace
          this step.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen">
      <Sidebar
        projects={state.projects}
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        onChooseProject={chooseFolder}
        onNewSession={startNewSession}
        onSelectSession={selectSession}
        onCloseSession={closeSession}
        onCloseProject={closeProject}
        onOpenSettings={() => setShowSettings(true)}
        starting={starting}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} />
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2.5">
              <FolderSwitcher
                cwd={activeProject?.cwd ?? null}
                onChoose={chooseFolder}
                loading={starting && !activeProject}
              />
            </header>

            {error && (
              <div className="border-b border-hooman-error/30 bg-hooman-error/10 px-4 py-2 text-[13px] text-hooman-error">
                {error}
              </div>
            )}

            <Transcript
              state={transcript}
              sessionId={activeSession?.sessionId ?? null}
              scrollToken={scrollToken}
            />

            <Composer
              state={transcript}
              disabled={!activeSession}
              sending={sending}
              promptStartedAt={promptStartedAt}
              onSend={send}
              onCancel={cancel}
              onSetConfigOption={setConfigOption}
            />
          </>
        )}
      </div>

      {!showSettings && (
        <RightPanel
          state={transcript}
          onStopShellJob={stopShellJob}
          onKeepEdit={keepEdit}
          onUndoEdit={undoEdit}
          onKeepAllEdits={keepAllEdits}
          onUndoAllEdits={undoAllEdits}
        />
      )}

      {permissionRequest && (
        <PermissionModal
          request={permissionRequest}
          onRespond={(optionId) => {
            window.hooman.respondToPermission(
              permissionRequest.requestId,
              optionId,
            );
            setPermissionRequest(null);
          }}
        />
      )}

      <Toaster />
    </div>
  );
}
