import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  MessageSquare,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  SquarePen,
  Terminal,
  Trash2,
  X,
} from "lucide-solid";
import type { SearchScope, SessionRowInfo } from "../../src/shared/protocol";
import {
  closeSessionsPanel,
  createNewProjectAction,
  deleteSessionRow,
  executeCommandAction,
  newChatFromPanel,
  openFileAction,
  openProjectAction,
  openSessionRow,
  renameSessionRow,
  searchItems,
  state,
  toggleArchiveSessionRow,
  togglePinSessionRow,
} from "../store";
import { dateGroupLabel, formatCompactTime } from "../lib/format";

type GroupBy = "none" | "date" | "project";
type SortBy = "last_updated" | "created" | "title";
type FilterMode = "all" | "active" | "pinned";
type DisplayMode = "comfortable" | "compact";

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  row: SessionRowInfo | null;
  copySubmenu: boolean;
}

const SCOPES: { id: SearchScope; title: string; placeholder: string }[] = [
  { id: "commands", title: "Commands", placeholder: "Search for commands…" },
  { id: "files", title: "Files", placeholder: "Search for files…" },
  { id: "conversations", title: "Conversations", placeholder: "Search for conversations…" },
  { id: "projects", title: "Projects", placeholder: "Search for projects…" },
];

export default function SessionsPanel() {
  const [query, setQuery] = createSignal("");
  const [scope, setScope] = createSignal<SearchScope>("conversations");
  const [scopeMenuOpen, setScopeMenuOpen] = createSignal(false);
  const [displayMenuOpen, setDisplayMenuOpen] = createSignal(false);

  // Display options
  const [groupBy, setGroupBy] = createSignal<GroupBy>("date");
  const [sortBy, setSortBy] = createSignal<SortBy>("last_updated");
  const [filterMode, setFilterMode] = createSignal<FilterMode>("all");
  const [displayMode, setDisplayMode] = createSignal<DisplayMode>("comfortable");
  const [autoPin, setAutoPin] = createSignal(false);
  const [archivedOnly, setArchivedOnly] = createSignal(false);

  // Submenu states inside display options
  const [openSubmenu, setOpenSubmenu] = createSignal<string | null>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameText, setRenameText] = createSignal("");
  let renameInputRef: HTMLInputElement | undefined;

  // Context menu state
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    row: null,
    copySubmenu: false,
  });

  let searchRef: HTMLInputElement | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    if (state.sessionsOpen) {
      setQuery("");
      setScope("conversations");
      setRenamingId(null);
      setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
      queueMicrotask(() => searchRef?.focus());
    }
  });

  const triggerSearch = (q: string, s: SearchScope) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchItems(q, s);
    }, 150);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (contextMenu().open) {
        setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
        return;
      }
      if (renamingId()) {
        setRenamingId(null);
        return;
      }
      if (scopeMenuOpen()) {
        setScopeMenuOpen(false);
        return;
      }
      if (displayMenuOpen()) {
        setDisplayMenuOpen(false);
        return;
      }
      if (state.sessionsOpen) {
        event.preventDefault();
        closeSessionsPanel();
      }
    }
  };

  const onGlobalClick = () => {
    if (contextMenu().open) {
      setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
    }
    if (scopeMenuOpen()) {
      setScopeMenuOpen(false);
    }
    if (displayMenuOpen()) {
      setDisplayMenuOpen(false);
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("click", onGlobalClick);
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("click", onGlobalClick);
    if (searchTimer) clearTimeout(searchTimer);
  });

  const startRename = (row: SessionRowInfo) => {
    setRenamingId(row.sessionId);
    setRenameText(row.title);
    setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  };

  const commitRename = (row: SessionRowInfo) => {
    const nextTitle = renameText().trim();
    if (nextTitle && nextTitle !== row.title) {
      renameSessionRow(row.sessionId, nextTitle);
    }
    setRenamingId(null);
  };

  const activePlaceholder = () => {
    const s = SCOPES.find((sc) => sc.id === scope());
    return s ? s.placeholder : "Search…";
  };

  const activeScopeTitle = () => {
    const s = SCOPES.find((sc) => sc.id === scope());
    return s ? s.title : "Conversations";
  };

  // Filtered & sorted session list
  const filteredSessions = createMemo(() => {
    const needle = query().trim().toLowerCase();
    let rows = state.persistedSessions;

    // Filter archived
    if (archivedOnly()) {
      rows = rows.filter((r) => r.archived);
    } else {
      rows = rows.filter((r) => !r.archived);
    }

    // Filter mode
    if (filterMode() === "pinned") {
      rows = rows.filter((r) => r.pinned);
    } else if (filterMode() === "active") {
      rows = rows.filter((r) => r.busy || r.current);
    }

    // Text search (if query is present)
    if (needle) {
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(needle) ||
          (r.projectName && r.projectName.toLowerCase().includes(needle)) ||
          (r.matchSnippet && r.matchSnippet.toLowerCase().includes(needle)),
      );
    }

    // Sorting
    const sorted = [...rows];
    sorted.sort((a, b) => {
      // Pinned always on top
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      if (sortBy() === "title") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy() === "created") {
        return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
      }
      return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
    });

    return sorted;
  });

  // Grouped session groups
  const sessionGroups = createMemo(() => {
    const rows = filteredSessions();
    const mode = groupBy();

    if (mode === "none") {
      return [{ label: "", rows }];
    }

    if (mode === "project") {
      const byProject = new Map<string, SessionRowInfo[]>();
      for (const row of rows) {
        const p = row.projectName || "Default Project";
        const bucket = byProject.get(p);
        if (bucket) {
          bucket.push(row);
        } else {
          byProject.set(p, [row]);
        }
      }
      return Array.from(byProject.entries()).map(([label, rws]) => ({
        label,
        rows: rws,
      }));
    }

    // Default "date" grouping
    const GROUP_ORDER = ["Pinned", "Today", "Yesterday", "Last 7 days", "Older"];
    const byLabel = new Map<string, SessionRowInfo[]>();

    for (const row of rows) {
      const label = row.pinned ? "Pinned" : dateGroupLabel(row.updatedAt);
      const bucket = byLabel.get(label);
      if (bucket) {
        bucket.push(row);
      } else {
        byLabel.set(label, [row]);
      }
    }

    return GROUP_ORDER.filter((label) => byLabel.has(label)).map((label) => ({
      label,
      rows: byLabel.get(label)!,
    }));
  });

  const onRowContextMenu = (event: MouseEvent, row: SessionRowInfo) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      open: true,
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 200),
      row,
      copySubmenu: false,
    });
  };

  const copyText = (text: string) => {
    navigator.clipboard?.writeText(text);
    setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
  };

  return (
    <Show when={state.sessionsOpen}>
      <div class="absolute inset-0 z-40 flex flex-col bg-background select-none">
        {/* Header (Screenshot 2) */}
        <div class="relative flex items-center gap-1.5 border-b border-border px-3 py-2">
          <span class="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-wide text-foreground">
            Conversations
          </span>

          {/* Display Options Button */}
          <div class="relative">
            <button
              type="button"
              class={`rounded p-1 text-muted transition-colors hover:bg-panel hover:text-foreground ${
                displayMenuOpen() ? "bg-panel text-foreground" : ""
              }`}
              title="Display options"
              onClick={(e) => {
                e.stopPropagation();
                setDisplayMenuOpen(!displayMenuOpen());
                setScopeMenuOpen(false);
              }}
            >
              <SlidersHorizontal size={13} />
            </button>

            {/* Display Options Menu Popup (Screenshot 2) */}
            <Show when={displayMenuOpen()}>
              <div
                class="absolute right-0 top-full mt-1 z-50 w-52 rounded-md border border-border bg-panel p-1 shadow-lg text-[12px] text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Group By */}
                <div class="relative group/menu">
                  <div
                    class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
                    onMouseEnter={() => setOpenSubmenu("group")}
                  >
                    <span>Group By</span>
                    <span class="flex items-center gap-1 text-[11px] text-muted">
                      {groupBy() === "none"
                        ? "None"
                        : groupBy() === "project"
                          ? "Project"
                          : "Date"}
                      <ChevronRight size={12} />
                    </span>
                  </div>
                  <Show when={openSubmenu() === "group"}>
                    <div class="absolute left-full top-0 ml-1 z-50 w-36 rounded-md border border-border bg-panel p-1 shadow-lg text-[12px]">
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          groupBy() === "none" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setGroupBy("none");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>None</span>
                        <Show when={groupBy() === "none"}>
                          <Check size={12} />
                        </Show>
                      </div>
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          groupBy() === "date" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setGroupBy("date");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Date</span>
                        <Show when={groupBy() === "date"}>
                          <Check size={12} />
                        </Show>
                      </div>
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          groupBy() === "project" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setGroupBy("project");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Project</span>
                        <Show when={groupBy() === "project"}>
                          <Check size={12} />
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>

                {/* Sort Conversations */}
                <div class="relative group/menu">
                  <div
                    class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
                    onMouseEnter={() => setOpenSubmenu("sort")}
                  >
                    <span>Sort Conversations</span>
                    <span class="flex items-center gap-1 text-[11px] text-muted">
                      {sortBy() === "last_updated"
                        ? "Last Updated"
                        : sortBy() === "created"
                          ? "Created Date"
                          : "Title"}
                      <ChevronRight size={12} />
                    </span>
                  </div>
                  <Show when={openSubmenu() === "sort"}>
                    <div class="absolute left-full top-0 ml-1 z-50 w-40 rounded-md border border-border bg-panel p-1 shadow-lg text-[12px]">
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          sortBy() === "last_updated" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setSortBy("last_updated");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Last Updated</span>
                        <Show when={sortBy() === "last_updated"}>
                          <Check size={12} />
                        </Show>
                      </div>
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          sortBy() === "created" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setSortBy("created");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Created Date</span>
                        <Show when={sortBy() === "created"}>
                          <Check size={12} />
                        </Show>
                      </div>
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          sortBy() === "title" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setSortBy("title");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Title (A-Z)</span>
                        <Show when={sortBy() === "title"}>
                          <Check size={12} />
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>

                {/* Filter */}
                <div class="relative group/menu">
                  <div
                    class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
                    onMouseEnter={() => setOpenSubmenu("filter")}
                  >
                    <span>Filter</span>
                    <span class="flex items-center gap-1 text-[11px] text-muted">
                      {filterMode() === "all"
                        ? "All"
                        : filterMode() === "active"
                          ? "Active"
                          : "Pinned"}
                      <ChevronRight size={12} />
                    </span>
                  </div>
                  <Show when={openSubmenu() === "filter"}>
                    <div class="absolute left-full top-0 ml-1 z-50 w-36 rounded-md border border-border bg-panel p-1 shadow-lg text-[12px]">
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          filterMode() === "all" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setFilterMode("all");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>All</span>
                        <Show when={filterMode() === "all"}>
                          <Check size={12} />
                        </Show>
                      </div>
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          filterMode() === "active" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setFilterMode("active");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Active / Running</span>
                        <Show when={filterMode() === "active"}>
                          <Check size={12} />
                        </Show>
                      </div>
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          filterMode() === "pinned" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setFilterMode("pinned");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Pinned Only</span>
                        <Show when={filterMode() === "pinned"}>
                          <Check size={12} />
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>

                {/* Display */}
                <div class="relative group/menu">
                  <div
                    class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
                    onMouseEnter={() => setOpenSubmenu("display")}
                  >
                    <span>Display</span>
                    <span class="flex items-center gap-1 text-[11px] text-muted">
                      {displayMode() === "comfortable" ? "Comfortable" : "Compact"}
                      <ChevronRight size={12} />
                    </span>
                  </div>
                  <Show when={openSubmenu() === "display"}>
                    <div class="absolute left-full top-0 ml-1 z-50 w-36 rounded-md border border-border bg-panel p-1 shadow-lg text-[12px]">
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          displayMode() === "comfortable" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setDisplayMode("comfortable");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Comfortable</span>
                        <Show when={displayMode() === "comfortable"}>
                          <Check size={12} />
                        </Show>
                      </div>
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          displayMode() === "compact" ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setDisplayMode("compact");
                          setOpenSubmenu(null);
                        }}
                      >
                        <span>Compact</span>
                        <Show when={displayMode() === "compact"}>
                          <Check size={12} />
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>

                <div class="my-1 h-px bg-border" />

                {/* Auto Pin Toggle */}
                <div
                  class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
                  onClick={() => setAutoPin(!autoPin())}
                >
                  <span>Auto Pin</span>
                  <Show when={autoPin()}>
                    <Check size={12} class="text-accent" />
                  </Show>
                </div>

                {/* Archived Only Toggle */}
                <div
                  class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
                  onClick={() => setArchivedOnly(!archivedOnly())}
                >
                  <span>Archived Only</span>
                  <Show when={archivedOnly()}>
                    <Check size={12} class="text-accent" />
                  </Show>
                </div>

                <div class="my-1 h-px bg-border" />

                {/* Mark All as Read */}
                <div
                  class="rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
                  onClick={() => {
                    setDisplayMenuOpen(false);
                  }}
                >
                  Mark All as Read
                </div>
              </div>
            </Show>
          </div>

          {/* Create New Project Button */}
          <button
            type="button"
            class="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-foreground"
            title="Create new project"
            onClick={() => createNewProjectAction()}
          >
            <FolderPlus size={14} />
          </button>

          {/* New Chat Button */}
          <button
            type="button"
            class="btn btn-secondary"
            title="Start a new chat"
            onClick={() => newChatFromPanel()}
          >
            <Plus size={11} />
            New chat
          </button>

          {/* Close Button */}
          <button
            type="button"
            class="shrink-0 rounded p-1 text-muted transition-colors hover:bg-panel hover:text-foreground"
            title="Close (Esc)"
            onClick={() => closeSessionsPanel()}
          >
            <X size={14} />
          </button>
        </div>

        {/* Search Box with Scope Selector (Screenshot 1 & 6) */}
        <div class="px-3 pt-2">
          <div class="relative flex items-center rounded-md border border-input-border bg-input px-1.5 py-1 focus-within:border-accent">
            {/* Scope Dropdown Button */}
            <div class="relative">
              <button
                type="button"
                class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-muted hover:bg-panel hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setScopeMenuOpen(!scopeMenuOpen());
                  setDisplayMenuOpen(false);
                }}
              >
                <span>{activeScopeTitle()}</span>
                <ChevronDown size={11} />
              </button>

              {/* Scope Dropdown Menu (Screenshot 6) */}
              <Show when={scopeMenuOpen()}>
                <div
                  class="absolute left-0 top-full mt-1 z-50 w-36 rounded-md border border-border bg-panel p-1 shadow-lg text-[12px] text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <For each={SCOPES}>
                    {(sc) => (
                      <div
                        class={`flex items-center justify-between rounded px-2 py-1.5 cursor-pointer hover:bg-list-hover-bg hover:text-list-hover-fg ${
                          scope() === sc.id ? "font-semibold text-accent" : ""
                        }`}
                        onClick={() => {
                          setScope(sc.id);
                          setScopeMenuOpen(false);
                          triggerSearch(query(), sc.id);
                        }}
                      >
                        <span>{sc.title}</span>
                        <Show when={scope() === sc.id}>
                          <Check size={12} class="text-accent" />
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <span class="mx-1 h-3 w-px bg-border" />

            <Search size={12} class="shrink-0 text-muted" />

            {/* Search Input */}
            <input
              ref={searchRef}
              type="text"
              class="min-w-0 flex-1 border-none bg-transparent px-1.5 text-[12.5px] text-input-foreground outline-none placeholder:text-muted"
              placeholder={activePlaceholder()}
              value={query()}
              onInput={(event) => {
                const val = event.currentTarget.value;
                setQuery(val);
                triggerSearch(val, scope());
              }}
            />

            {/* Clear Button */}
            <Show when={query().trim()}>
              <button
                type="button"
                class="rounded p-0.5 text-muted hover:text-foreground"
                title="Clear"
                onClick={() => {
                  setQuery("");
                  triggerSearch("", scope());
                }}
              >
                <X size={12} />
              </button>
            </Show>

            {/* Filter icon button on right of search input */}
            <button
              type="button"
              class="ml-1 rounded p-0.5 text-muted hover:text-foreground"
              title="Display options"
              onClick={(e) => {
                e.stopPropagation();
                setDisplayMenuOpen(!displayMenuOpen());
              }}
            >
              <SlidersHorizontal size={12} />
            </button>
          </div>
        </div>

        {/* List Content */}
        <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 pt-1 scroll-thin">
          {/* Scope: Conversations */}
          <Show when={scope() === "conversations"}>
            <Show
              when={sessionGroups().length > 0 && sessionGroups().some((g) => g.rows.length > 0)}
              fallback={
                <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12.5px] text-muted">
                  <Show
                    when={query().trim()}
                    fallback={<span>No saved conversations yet.</span>}
                  >
                    <span>No conversations match "{query().trim()}".</span>
                  </Show>
                </div>
              }
            >
              <For each={sessionGroups()}>
                {(group) => (
                  <Show when={group.rows.length > 0}>
                    <div>
                      <Show when={group.label}>
                        <div class="px-2 pb-0.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                          {group.label}
                        </div>
                      </Show>
                      <For each={group.rows}>
                        {(row) => {
                          const isRenaming = () => renamingId() === row.sessionId;
                          return (
                            <div
                              class={`group relative flex w-full cursor-pointer items-start gap-2 rounded-md px-2 hover:bg-list-active-bg hover:text-list-active-fg transition-colors ${
                                displayMode() === "compact" ? "py-1" : "py-1.5"
                              } ${row.current ? "bg-list-active-bg/40 font-medium" : ""}`}
                              onClick={() => {
                                if (!isRenaming()) {
                                  openSessionRow(row);
                                }
                              }}
                              onContextMenu={(e) => onRowContextMenu(e, row)}
                            >
                              {/* Left Status Icon */}
                              <span class="mt-0.5 flex w-4 shrink-0 items-center justify-center">
                                <Show
                                  when={row.busy}
                                  fallback={
                                    <Show
                                      when={row.pinned}
                                      fallback={
                                        <Show
                                          when={row.current}
                                          fallback={
                                            <MessageSquare size={13} class="text-muted" />
                                          }
                                        >
                                          <span class="h-2 w-2 rounded-full bg-success" />
                                        </Show>
                                      }
                                    >
                                      <Pin size={12} class="text-accent rotate-45" />
                                    </Show>
                                  }
                                >
                                  <Loader2
                                    size={13}
                                    class="animate-spin text-accent"
                                  />
                                </Show>
                              </span>

                              {/* Title & Metadata */}
                              <div class="min-w-0 flex-1">
                                <Show
                                  when={isRenaming()}
                                  fallback={
                                    <div class="flex items-center gap-1.5">
                                      <span
                                        class="min-w-0 flex-1 truncate text-[12.5px]"
                                        title={row.title}
                                      >
                                        {row.title}
                                      </span>
                                      {/* Project badge tag (Screenshot 1 & 2) */}
                                      <span class="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.2 text-[10px] text-muted bg-panel border border-border/50">
                                        <Folder size={9} />
                                        <span>{row.projectName || "bitbucket"}</span>
                                      </span>
                                    </div>
                                  }
                                >
                                  {/* Inline Rename Form */}
                                  <div
                                    class="flex items-center gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      ref={renameInputRef}
                                      type="text"
                                      class="min-w-0 flex-1 rounded border border-accent bg-input px-1.5 py-0.5 text-[12px] text-input-foreground outline-none"
                                      value={renameText()}
                                      onInput={(e) => setRenameText(e.currentTarget.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          commitRename(row);
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          setRenamingId(null);
                                        }
                                      }}
                                      onBlur={() => commitRename(row)}
                                    />
                                    <button
                                      type="button"
                                      class="rounded p-1 text-accent hover:bg-panel"
                                      title="Save"
                                      onClick={() => commitRename(row)}
                                    >
                                      <Check size={12} />
                                    </button>
                                  </div>
                                </Show>

                                {/* Chat History Message Match Snippet */}
                                <Show when={row.matchSnippet && !isRenaming()}>
                                  <div
                                    class="mt-0.5 truncate text-[11px] text-muted italic flex items-center gap-1"
                                    title={row.matchSnippet}
                                  >
                                    <MessageSquare size={10} class="shrink-0 opacity-70" />
                                    <span>{row.matchSnippet}</span>
                                  </div>
                                </Show>
                              </div>

                              {/* Relative Time (Screenshot 1 & 2) */}
                              <span class="shrink-0 text-[11px] text-muted group-hover:hidden mt-0.5">
                                {row.busy
                                  ? "running…"
                                  : row.current
                                    ? "current"
                                    : row.updatedAt
                                      ? formatCompactTime(row.updatedAt)
                                      : ""}
                              </span>

                              {/* Hover Action Buttons */}
                              <div class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                                {/* Rename Button */}
                                <button
                                  type="button"
                                  class="rounded p-1 text-muted hover:bg-panel hover:text-foreground"
                                  title="Rename conversation"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startRename(row);
                                  }}
                                >
                                  <SquarePen size={12} />
                                </button>

                                {/* Pin/Unpin Button */}
                                <button
                                  type="button"
                                  class={`rounded p-1 hover:bg-panel ${
                                    row.pinned
                                      ? "text-accent"
                                      : "text-muted hover:text-foreground"
                                  }`}
                                  title={row.pinned ? "Unpin" : "Pin"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    togglePinSessionRow(row.sessionId);
                                  }}
                                >
                                  <Pin size={12} />
                                </button>

                                {/* Delete Button */}
                                <button
                                  type="button"
                                  class="rounded p-1 text-muted hover:bg-panel hover:text-removed"
                                  title="Delete conversation"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteSessionRow(row);
                                  }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                )}
              </For>
            </Show>
          </Show>

          {/* Scope: Commands */}
          <Show when={scope() === "commands"}>
            <Show
              when={(state.searchResults?.commands ?? []).length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12.5px] text-muted">
                  <span>No commands found.</span>
                </div>
              }
            >
              <div class="px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                Commands
              </div>
              <For each={state.searchResults?.commands ?? []}>
                {(cmd) => (
                  <div
                    class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-list-active-bg hover:text-list-active-fg transition-colors"
                    onClick={() => {
                      executeCommandAction(cmd.id);
                      closeSessionsPanel();
                    }}
                  >
                    <Terminal size={13} class="shrink-0 text-muted" />
                    <span class="min-w-0 flex-1 truncate">{cmd.title}</span>
                    <Show when={cmd.category}>
                      <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted bg-panel border border-border">
                        {cmd.category}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>

          {/* Scope: Files */}
          <Show when={scope() === "files"}>
            <Show
              when={(state.searchResults?.files ?? []).length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12.5px] text-muted">
                  <span>No files match your search.</span>
                </div>
              }
            >
              <div class="px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                Files
              </div>
              <For each={state.searchResults?.files ?? []}>
                {(file) => (
                  <div
                    class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-list-active-bg hover:text-list-active-fg transition-colors"
                    onClick={() => {
                      openFileAction(file.path);
                      closeSessionsPanel();
                    }}
                  >
                    <FileText size={13} class="shrink-0 text-muted" />
                    <div class="min-w-0 flex-1 truncate">
                      <span class="font-medium">{file.name}</span>
                      <span class="ml-2 text-[11px] text-muted">
                        {file.relativePath}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>

          {/* Scope: Projects */}
          <Show when={scope() === "projects"}>
            <Show
              when={(state.searchResults?.projects ?? []).length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12.5px] text-muted">
                  <span>No projects found.</span>
                </div>
              }
            >
              <div class="px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                Projects
              </div>
              <For each={state.searchResults?.projects ?? []}>
                {(proj) => (
                  <div
                    class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-list-active-bg hover:text-list-active-fg transition-colors"
                    onClick={() => {
                      openProjectAction(proj.path);
                      closeSessionsPanel();
                    }}
                  >
                    <Folder size={13} class="shrink-0 text-accent" />
                    <div class="min-w-0 flex-1 truncate">
                      <span class="font-medium">{proj.name}</span>
                      <span class="ml-2 text-[11px] text-muted">{proj.path}</span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>

        {/* Right-Click Context Menu (Screenshot 3) */}
        <Show when={contextMenu().open && contextMenu().row}>
          <div
            class="fixed z-50 w-44 rounded-md border border-border bg-panel p-1 shadow-xl text-[12px] text-foreground"
            style={{
              left: `${contextMenu().x}px`,
              top: `${contextMenu().y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Rename */}
            <div
              class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
              onClick={() => startRename(contextMenu().row!)}
            >
              <SquarePen size={13} class="text-muted" />
              <span>Rename</span>
            </div>

            {/* Pin / Unpin */}
            <div
              class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
              onClick={() => {
                togglePinSessionRow(contextMenu().row!.sessionId);
                setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
              }}
            >
              <Pin size={13} class="text-muted" />
              <span>{contextMenu().row!.pinned ? "Unpin" : "Pin"}</span>
            </div>

            {/* Archive */}
            <div
              class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer"
              onClick={() => {
                toggleArchiveSessionRow(contextMenu().row!.sessionId);
                setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
              }}
            >
              <Archive size={13} class="text-muted" />
              <span>{contextMenu().row!.archived ? "Unarchive" : "Archive"}</span>
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
                    onClick={() => copyText(contextMenu().row!.title)}
                  >
                    Copy Title
                  </div>
                  <div
                    class="rounded px-2 py-1.5 hover:bg-list-hover-bg hover:text-list-hover-fg cursor-pointer truncate"
                    onClick={() => copyText(contextMenu().row!.sessionId)}
                  >
                    Copy Session ID
                  </div>
                </div>
              </Show>
            </div>

            <div class="my-1 h-px bg-border" />

            {/* Delete */}
            <div
              class="flex items-center gap-2 rounded px-2 py-1.5 text-removed hover:bg-list-hover-bg cursor-pointer"
              onClick={() => {
                deleteSessionRow(contextMenu().row!);
                setContextMenu({ open: false, x: 0, y: 0, row: null, copySubmenu: false });
              }}
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
