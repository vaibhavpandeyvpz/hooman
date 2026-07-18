import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MessageSquare,
  Plus,
  Settings,
  X,
} from "lucide-react";
import type { ProjectEntry, SessionEntry } from "../store.js";
import { cn } from "../lib/cn.js";
import { formatRelativeTime } from "../lib/format.js";

export function Sidebar({
  projects,
  sessions,
  activeSessionId,
  onChooseProject,
  onNewSession,
  onSelectSession,
  onCloseSession,
  onCloseProject,
  onOpenSettings,
  starting,
}: {
  projects: ProjectEntry[];
  sessions: SessionEntry[];
  activeSessionId: string | null;
  onChooseProject: () => void;
  onNewSession: (projectId: string) => void;
  onSelectSession: (projectId: string, sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseProject: (projectId: string) => void;
  onOpenSettings: () => void;
  starting: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (projectId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
        <span className="text-[12px] font-medium uppercase tracking-wide text-hooman-muted">
          Sessions
        </span>
        <button
          type="button"
          title="Open a different folder"
          className="shrink-0 rounded-md p-1 text-hooman-muted hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
          onClick={onChooseProject}
          disabled={starting}
        >
          <FolderPlus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {projects.length === 0 && (
          <p className="px-1.5 py-2 text-[12px] text-hooman-muted">
            {starting
              ? "Starting a session in your home directory…"
              : "No folder open yet."}
          </p>
        )}
        {projects.map((project) => {
          const projectSessions = sessions.filter(
            (s) => s.projectId === project.projectId,
          );
          const isCollapsed = collapsed.has(project.projectId);
          return (
            <div key={project.projectId}>
              <div
                className="group flex items-center gap-1 rounded-md px-1 py-1 cursor-pointer hover:bg-slate-900"
                onClick={() => toggleCollapsed(project.projectId)}
              >
                {isCollapsed ? (
                  <ChevronRight
                    size={12}
                    className="shrink-0 text-hooman-muted"
                  />
                ) : (
                  <ChevronDown
                    size={12}
                    className="shrink-0 text-hooman-muted"
                  />
                )}
                <span
                  className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-hooman-muted"
                  title={project.cwd}
                >
                  {project.cwd.split("/").pop() || project.cwd}
                </span>
                <button
                  type="button"
                  title="New chat"
                  aria-label="New chat"
                  className="shrink-0 rounded-md p-1 text-hooman-muted opacity-0 hover:bg-slate-800 hover:text-slate-100 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewSession(project.projectId);
                  }}
                >
                  <Plus size={13} />
                </button>
                <button
                  type="button"
                  title="Remove this folder from the sidebar"
                  aria-label="Remove this folder from the sidebar"
                  className="shrink-0 rounded-md p-1 text-hooman-muted opacity-0 hover:bg-slate-800 hover:text-hooman-error group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseProject(project.projectId);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
              {!isCollapsed && (
                <div className="ml-2.5 space-y-0.5 border-l border-slate-800 pl-1.5">
                  {projectSessions.length === 0 ? (
                    <p className="px-2 py-1 text-[12px] text-hooman-muted">
                      No sessions yet.
                    </p>
                  ) : (
                    projectSessions.map((session) => {
                      const active = session.sessionId === activeSessionId;
                      return (
                        <div
                          key={session.sessionId}
                          className={cn(
                            "group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] cursor-pointer",
                            active ? "bg-slate-800" : "hover:bg-slate-900",
                          )}
                          onClick={() =>
                            onSelectSession(
                              project.projectId,
                              session.sessionId,
                            )
                          }
                        >
                          <MessageSquare
                            size={13}
                            className={cn(
                              "shrink-0",
                              active
                                ? "text-hooman-primary"
                                : "text-hooman-muted",
                            )}
                          />
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={session.title}
                          >
                            {session.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-hooman-muted group-hover:hidden">
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                          <button
                            type="button"
                            className="hidden shrink-0 rounded p-1 text-hooman-muted hover:bg-slate-800 hover:text-hooman-error group-hover:block"
                            title="Close this session"
                            aria-label="Close this session"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCloseSession(session.sessionId);
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-800 p-2">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-hooman-muted hover:bg-slate-900 hover:text-slate-100"
          onClick={onOpenSettings}
        >
          <Settings size={13} />
          Settings
        </button>
      </div>
    </aside>
  );
}
