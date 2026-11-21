import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
  Archive,
  ChevronRight,
  Copy,
  Loader2,
  Pin,
  SquarePen,
  Trash2,
  X,
} from "lucide-solid";
import type { TabInfo } from "../../src/shared/protocol";
import { post } from "../lib/vscode-api";
import {
  activateTab,
  closeTab,
  renameSessionRow,
  state,
  toggleArchiveSessionRow,
  togglePinSessionRow,
} from "../store";

interface TabContextMenuState {
  open: boolean;
  x: number;
  y: number;
  tab: TabInfo | null;
  copySubmenu: boolean;
}

function copyToClipboard(text: string): void {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  } catch {
    // fallback
  }
}

export default function TabStrip() {
  let scroller: HTMLDivElement | undefined;
  const tabRefs = new Map<string, HTMLButtonElement>();

  // Inline rename state
  const [renamingSessionId, setRenamingSessionId] = createSignal<string | null>(
    null,
  );
  const [renameText, setRenameText] = createSignal("");

  // Context menu state
  const [contextMenu, setContextMenu] = createSignal<TabContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    tab: null,
    copySubmenu: false,
  });

  createEffect(() => {
    const activeSessionId = state.activeSessionId;
    state.tabs.length;
    queueMicrotask(() => {
      if (!activeSessionId) return;
      const tab = tabRefs.get(activeSessionId);
      tab?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (contextMenu().open) {
        setContextMenu({
          open: false,
          x: 0,
          y: 0,
          tab: null,
          copySubmenu: false,
        });
        return;
      }
      if (renamingSessionId()) {
        setRenamingSessionId(null);
      }
    }
  };

  const onGlobalClick = () => {
    if (contextMenu().open) {
      setContextMenu({
        open: false,
        x: 0,
        y: 0,
        tab: null,
        copySubmenu: false,
      });
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("click", onGlobalClick);
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("click", onGlobalClick);
  });

  const startRename = (tab: TabInfo) => {
    setRenamingSessionId(tab.sessionId);
    setRenameText(tab.title);
    setContextMenu({ open: false, x: 0, y: 0, tab: null, copySubmenu: false });
  };

  const commitRename = (sessionId: string) => {
    const current = renamingSessionId();
    if (current !== sessionId) return;
    const text = renameText().trim();
    if (text) {
      renameSessionRow(sessionId, text);
    }
    setRenamingSessionId(null);
  };

  const cancelRename = () => {
    setRenamingSessionId(null);
  };

  const onTabContextMenu = (tab: TabInfo, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.activeSessionId !== tab.sessionId) {
      activateTab(tab.sessionId);
    }
    const menuWidth = 180;
    const menuHeight = 220;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) {
      x = Math.max(10, window.innerWidth - menuWidth - 8);
    }
    if (y + menuHeight > window.innerHeight) {
      y = Math.max(10, window.innerHeight - menuHeight - 8);
    }
    setContextMenu({
      open: true,
      x,
      y,
      tab,
      copySubmenu: false,
    });
  };

  const getSessionMeta = (sessionId: string) => {
    return state.persistedSessions.find((s) => s.sessionId === sessionId);
  };

  const closeOtherTabs = (keepSessionId: string) => {
    for (const t of state.tabs) {
      if (t.sessionId !== keepSessionId) {
        closeTab(t.sessionId);
      }
    }
    setContextMenu({ open: false, x: 0, y: 0, tab: null, copySubmenu: false });
  };

  const deleteTabSession = (tab: TabInfo) => {
    post({ type: "deleteSession", sessionId: tab.sessionId, title: tab.title });
    closeTab(tab.sessionId);
    setContextMenu({ open: false, x: 0, y: 0, tab: null, copySubmenu: false });
  };

  return (
    <div class="relative flex shrink-0 items-stretch border-y border-[var(--vscode-editorGroupHeader-tabsBorder,var(--vscode-panel-border,var(--vscode-widget-border,transparent)))] bg-[var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-sideBar-background))] select-none">
      <div
        ref={scroller}
        class="scroll-thin min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div class="flex min-w-max">
          <For each={state.tabs}>
            {(tab) => {
              const active = () => state.activeSessionId === tab.sessionId;
              const isRenaming = () => renamingSessionId() === tab.sessionId;
              return (
                <button
                  ref={(el) => tabRefs.set(tab.sessionId, el)}
                  type="button"
                  class={`group relative flex h-9 min-w-32 max-w-64 shrink-0 items-center gap-1.5 border-r border-[var(--vscode-editorGroupHeader-tabsBorder,var(--vscode-panel-border,var(--vscode-widget-border,transparent)))] px-3 text-[12px] ${
                    active()
                      ? "bg-[var(--vscode-tab-activeBackground,var(--vscode-editor-background))] text-[var(--vscode-tab-activeForeground,var(--vscode-foreground))]"
                      : "bg-[var(--vscode-tab-inactiveBackground,var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-sideBar-background)))] text-[var(--vscode-tab-inactiveForeground,var(--vscode-descriptionForeground))] hover:bg-[var(--vscode-tab-hoverBackground,var(--vscode-list-hoverBackground,var(--vscode-tab-inactiveBackground,var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-sideBar-background)))))] hover:text-[var(--vscode-tab-hoverForeground,var(--vscode-foreground))]"
                  }`}
                  title={tab.title}
                  onClick={() => {
                    if (!isRenaming()) {
                      activateTab(tab.sessionId);
                    }
                  }}
                  onContextMenu={(e) => onTabContextMenu(tab, e)}
                >
                  <Show when={active()}>
                    <span class="absolute inset-x-0 top-0 h-px bg-[var(--vscode-tab-activeBorderTop,var(--vscode-tab-activeBorder,var(--vscode-focusBorder)))]" />
                  </Show>
                  <Show when={tab.busy || tab.loading}>
                    <Loader2
                      size={11}
                      class="shrink-0 animate-spin-slow text-accent"
                      aria-label={tab.loading ? "Loading" : "Busy"}
                    />
                  </Show>

                  <Show
                    when={isRenaming()}
                    fallback={
                      <span
                        class="min-w-0 flex-1 truncate text-left leading-none"
                        onDblClick={(e) => {
                          e.stopPropagation();
                          startRename(tab);
                        }}
                      >
                        {tab.title}
                      </span>
                    }
                  >
                    <input
                      ref={(el) => {
                        requestAnimationFrame(() => {
                          el.focus();
                          el.select();
                        });
                      }}
                      type="text"
                      value={renameText()}
                      class="min-w-0 flex-1 rounded border border-accent bg-[var(--vscode-input-background)] px-1 py-0.5 text-[12px] text-[var(--vscode-input-foreground)] outline-none leading-none shadow-sm"
                      onClick={(e) => e.stopPropagation()}
                      onInput={(e) => setRenameText(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(tab.sessionId);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          cancelRename();
                        }
                      }}
                      onBlur={() => commitRename(tab.sessionId)}
                    />
                  </Show>

                  <Show when={tab.unread}>
                    <span
                      class="h-2 w-2 shrink-0 rounded-full bg-[var(--vscode-tab-unfocusedActiveBorder,var(--vscode-tab-activeBorder,var(--vscode-textLink-foreground)))]"
                      title="Unread background activity"
                    />
                  </Show>
                  <Show when={(tab.pendingPermissions ?? 0) > 0}>
                    <span
                      class="shrink-0 rounded-sm bg-warning px-1 py-0.5 text-[10px] font-medium leading-none text-black"
                      title={`${tab.pendingPermissions} pending permission prompt${(tab.pendingPermissions ?? 0) === 1 ? "" : "s"}`}
                    >
                      {tab.pendingPermissions}
                    </span>
                  </Show>
                  <span
                    class="shrink-0 rounded-sm p-0.5 text-inherit opacity-70 hover:bg-[var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground,transparent))] hover:opacity-100"
                    title="Close tab"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.sessionId);
                    }}
                  >
                    <X size={11} />
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* Right-Click Context Menu for Conversation Tab (Screenshot 3 style) */}
      <Show when={contextMenu().open && contextMenu().tab}>
        <div
          class="fixed z-50 w-48 rounded-md border border-border bg-panel p-1 shadow-2xl text-[12px] text-foreground"
          style={{
            left: `${contextMenu().x}px`,
            top: `${contextMenu().y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Rename */}
          <div
            class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
            onClick={() => startRename(contextMenu().tab!)}
          >
            <SquarePen size={13} class="text-muted" />
            <span>Rename</span>
          </div>

          {/* Pin / Unpin */}
          <div
            class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
            onClick={() => {
              togglePinSessionRow(contextMenu().tab!.sessionId);
              setContextMenu({
                open: false,
                x: 0,
                y: 0,
                tab: null,
                copySubmenu: false,
              });
            }}
          >
            <Pin size={13} class="text-muted" />
            <span>
              {getSessionMeta(contextMenu().tab!.sessionId)?.pinned
                ? "Unpin"
                : "Pin"}
            </span>
          </div>

          {/* Archive */}
          <div
            class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
            onClick={() => {
              toggleArchiveSessionRow(contextMenu().tab!.sessionId);
              setContextMenu({
                open: false,
                x: 0,
                y: 0,
                tab: null,
                copySubmenu: false,
              });
            }}
          >
            <Archive size={13} class="text-muted" />
            <span>
              {getSessionMeta(contextMenu().tab!.sessionId)?.archived
                ? "Unarchive"
                : "Archive"}
            </span>
          </div>

          {/* Copy Submenu */}
          <div class="relative group/copy">
            <div
              class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
              onMouseEnter={() =>
                setContextMenu({ ...contextMenu(), copySubmenu: true })
              }
            >
              <div class="flex items-center gap-2">
                <Copy size={13} class="text-muted" />
                <span>Copy</span>
              </div>
              <ChevronRight size={12} class="text-muted" />
            </div>
            <Show when={contextMenu().copySubmenu}>
              <div class="absolute left-full top-0 ml-1 z-50 w-36 rounded-md border border-border bg-panel p-1 shadow-lg text-[12px]">
                <div
                  class="rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer truncate"
                  onClick={() => {
                    copyToClipboard(contextMenu().tab!.title);
                    setContextMenu({
                      open: false,
                      x: 0,
                      y: 0,
                      tab: null,
                      copySubmenu: false,
                    });
                  }}
                >
                  Copy Title
                </div>
                <div
                  class="rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer truncate"
                  onClick={() => {
                    copyToClipboard(contextMenu().tab!.sessionId);
                    setContextMenu({
                      open: false,
                      x: 0,
                      y: 0,
                      tab: null,
                      copySubmenu: false,
                    });
                  }}
                >
                  Copy Session ID
                </div>
              </div>
            </Show>
          </div>

          <div class="my-1 h-px bg-border" />

          {/* Close Tab */}
          <div
            class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
            onClick={() => {
              closeTab(contextMenu().tab!.sessionId);
              setContextMenu({
                open: false,
                x: 0,
                y: 0,
                tab: null,
                copySubmenu: false,
              });
            }}
          >
            <X size={13} class="text-muted" />
            <span>Close Tab</span>
          </div>

          {/* Close Other Tabs */}
          <Show when={state.tabs.length > 1}>
            <div
              class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
              onClick={() => closeOtherTabs(contextMenu().tab!.sessionId)}
            >
              <span class="w-3.5" />
              <span>Close Others</span>
            </div>
          </Show>

          <div class="my-1 h-px bg-border" />

          {/* Delete Conversation */}
          <div
            class="flex items-center gap-2 rounded px-2 py-1.5 text-removed hover:bg-list-hover-bg cursor-pointer"
            onClick={() => deleteTabSession(contextMenu().tab!)}
          >
            <Trash2 size={13} />
            <span>Delete</span>
          </div>
        </div>
      </Show>
    </div>
  );
}
