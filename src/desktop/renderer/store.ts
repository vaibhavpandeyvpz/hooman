import {
  applySessionUpdate,
  EMPTY_TRANSCRIPT,
  markShellJobStopping,
  resolveAllEdits,
  resolveEdit,
  type SessionUpdate,
  type TranscriptState,
} from "../shared/session-reducer.js";

export type ProjectEntry = { projectId: string; cwd: string };
export type SessionEntry = {
  sessionId: string;
  projectId: string;
  title: string;
  updatedAt?: string;
};

export type AppState = {
  projects: ProjectEntry[];
  sessions: SessionEntry[];
  transcripts: Record<string, TranscriptState>;
  activeSessionId: string | null;
};

export const INITIAL_APP_STATE: AppState = {
  projects: [],
  sessions: [],
  transcripts: {},
  activeSessionId: null,
};

export type AppAction =
  | { type: "project-opened"; project: ProjectEntry }
  | { type: "project-closed"; projectId: string }
  | { type: "session-added"; session: SessionEntry }
  | {
      type: "sessions-loaded";
      projectId: string;
      sessions: Array<{
        sessionId: string;
        title?: string;
        updatedAt?: string;
      }>;
    }
  | { type: "session-removed"; sessionId: string }
  | { type: "session-selected"; sessionId: string | null }
  | { type: "session-update"; sessionId: string; update: SessionUpdate }
  | { type: "shell-job-stopping"; sessionId: string; jobId: string }
  | { type: "edit-resolved"; sessionId: string; path: string }
  | { type: "edits-resolved"; sessionId: string; paths: string[] };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "project-opened": {
      if (state.projects.some((p) => p.projectId === action.project.projectId))
        return state;
      return { ...state, projects: [...state.projects, action.project] };
    }
    case "project-closed": {
      if (!state.projects.some((p) => p.projectId === action.projectId))
        return state;
      const removedSessionIds = new Set(
        state.sessions
          .filter((s) => s.projectId === action.projectId)
          .map((s) => s.sessionId),
      );
      const projects = state.projects.filter(
        (p) => p.projectId !== action.projectId,
      );
      const sessions = state.sessions.filter(
        (s) => s.projectId !== action.projectId,
      );
      const transcripts = { ...state.transcripts };
      for (const sessionId of removedSessionIds) delete transcripts[sessionId];
      const activeSessionId =
        state.activeSessionId !== null &&
        removedSessionIds.has(state.activeSessionId)
          ? (sessions[0]?.sessionId ?? null)
          : state.activeSessionId;
      return { ...state, projects, sessions, transcripts, activeSessionId };
    }
    case "sessions-loaded": {
      const existingIds = new Set(state.sessions.map((s) => s.sessionId));
      const loaded = action.sessions
        .filter((s) => !existingIds.has(s.sessionId))
        .map((s) => ({
          sessionId: s.sessionId,
          projectId: action.projectId,
          title: s.title ?? "Untitled session",
          updatedAt: s.updatedAt,
        }));
      if (loaded.length === 0) return state;
      const transcripts = { ...state.transcripts };
      for (const session of loaded)
        transcripts[session.sessionId] = EMPTY_TRANSCRIPT;
      return {
        ...state,
        sessions: [...state.sessions, ...loaded],
        transcripts,
      };
    }
    case "session-added": {
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        transcripts: {
          ...state.transcripts,
          [action.session.sessionId]: EMPTY_TRANSCRIPT,
        },
        activeSessionId: action.session.sessionId,
      };
    }
    case "session-removed": {
      const sessions = state.sessions.filter(
        (s) => s.sessionId !== action.sessionId,
      );
      const transcripts = { ...state.transcripts };
      delete transcripts[action.sessionId];
      const activeSessionId =
        state.activeSessionId === action.sessionId
          ? (sessions[0]?.sessionId ?? null)
          : state.activeSessionId;
      return { ...state, sessions, transcripts, activeSessionId };
    }
    case "session-selected":
      return { ...state, activeSessionId: action.sessionId };
    case "session-update": {
      const current = state.transcripts[action.sessionId] ?? EMPTY_TRANSCRIPT;
      return {
        ...state,
        transcripts: {
          ...state.transcripts,
          [action.sessionId]: applySessionUpdate(current, action.update),
        },
      };
    }
    case "shell-job-stopping": {
      const current = state.transcripts[action.sessionId] ?? EMPTY_TRANSCRIPT;
      return {
        ...state,
        transcripts: {
          ...state.transcripts,
          [action.sessionId]: markShellJobStopping(current, action.jobId),
        },
      };
    }
    case "edit-resolved": {
      const current = state.transcripts[action.sessionId] ?? EMPTY_TRANSCRIPT;
      return {
        ...state,
        transcripts: {
          ...state.transcripts,
          [action.sessionId]: resolveEdit(current, action.path),
        },
      };
    }
    case "edits-resolved": {
      const current = state.transcripts[action.sessionId] ?? EMPTY_TRANSCRIPT;
      return {
        ...state,
        transcripts: {
          ...state.transcripts,
          [action.sessionId]: resolveAllEdits(current, action.paths),
        },
      };
    }
    default:
      return state;
  }
}
