import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Loader2, MessageSquare, Plus, Search, Trash2, X } from "lucide-solid";
import type { SessionRowInfo } from "../../src/shared/protocol";
import {
  closeSessionsPanel,
  deleteSessionRow,
  newChatFromPanel,
  openSessionRow,
  state,
} from "../store";
import { dateGroupLabel, formatRelativeTime } from "../lib/format";

/** Group order for the history list; anything unknown sorts last. */
const GROUP_ORDER = ["Today", "Yesterday", "Last 7 Days", "Older"];

/**
 * Custom-rendered session history overlay covering the chat, opened from the
 * title-bar history button. Grouped by day, searchable, with
 * the ongoing session marked (spinner while a turn runs), click-to-open and
 * hover delete per row, and a New Chat action.
 */
export default function SessionsPanel() {
  const [query, setQuery] = createSignal("");
  let searchRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (state.sessionsOpen) {
      setQuery("");
      queueMicrotask(() => searchRef?.focus());
    }
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && state.sessionsOpen) {
      event.preventDefault();
      closeSessionsPanel();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  const groups = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const filtered = needle
      ? state.persistedSessions.filter((row) =>
          row.title.toLowerCase().includes(needle),
        )
      : state.persistedSessions;
    const byLabel = new Map<string, SessionRowInfo[]>();
    for (const row of filtered) {
      const label = dateGroupLabel(row.updatedAt);
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

  return (
    <Show when={state.sessionsOpen}>
      <div class="absolute inset-0 z-40 flex flex-col bg-background">
        <div class="flex items-center gap-1.5 border-b border-border px-3 py-2">
          <span class="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
            Sessions
          </span>
          <button
            type="button"
            class="flex shrink-0 items-center gap-1 rounded border border-button-border bg-button-secondary px-2 py-0.5 text-[11px] text-button-secondary-foreground hover:bg-button-secondary-hover"
            title="Start a new chat"
            onClick={() => newChatFromPanel()}
          >
            <Plus size={11} />
            New Chat
          </button>
          <button
            type="button"
            class="shrink-0 rounded p-1 text-muted hover:bg-panel hover:text-foreground"
            title="Close (Esc)"
            onClick={() => closeSessionsPanel()}
          >
            <X size={14} />
          </button>
        </div>
        <div class="px-3 pt-2">
          <div class="flex items-center gap-1.5 rounded-md border border-input-border bg-input px-2 py-1">
            <Search size={12} class="shrink-0 text-muted" />
            <input
              ref={searchRef}
              type="text"
              class="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-input-foreground outline-none placeholder:text-muted"
              placeholder="Search sessions…"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 pt-1 scroll-thin">
          <Show
            when={groups().length > 0}
            fallback={
              <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12.5px] text-muted">
                <Show
                  when={query().trim()}
                  fallback={
                    <span>No saved sessions for this project yet.</span>
                  }
                >
                  <span>No sessions match "{query().trim()}".</span>
                </Show>
              </div>
            }
          >
            <For each={groups()}>
              {(group) => (
                <div>
                  <div class="px-2 pb-0.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                    {group.label}
                  </div>
                  <For each={group.rows}>
                    {(row) => (
                      <div
                        class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-list-active-bg hover:text-list-active-fg"
                        onClick={() => openSessionRow(row)}
                      >
                        <span class="flex w-4 shrink-0 items-center justify-center">
                          <Show
                            when={row.busy}
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
                            <Loader2
                              size={13}
                              class="animate-spin text-accent"
                            />
                          </Show>
                        </span>
                        <span class="min-w-0 flex-1 truncate" title={row.title}>
                          {row.title}
                        </span>
                        <span class="shrink-0 text-[11px] text-muted group-hover:hidden">
                          {row.busy
                            ? "running…"
                            : row.current
                              ? "current"
                              : row.updatedAt
                                ? formatRelativeTime(row.updatedAt)
                                : ""}
                        </span>
                        <button
                          type="button"
                          class="hidden shrink-0 rounded p-1 text-muted hover:bg-panel hover:text-removed group-hover:block"
                          title="Delete this session"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteSessionRow(row);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </Show>
  );
}
