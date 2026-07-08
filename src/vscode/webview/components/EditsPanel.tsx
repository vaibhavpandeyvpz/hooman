import { createSignal, For, Show } from "solid-js";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  RotateCcw,
} from "lucide-solid";
import { editAction, sessionState } from "../store";

export default function EditsPanel() {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <Show when={sessionState().edits.length > 0}>
      <div class="mx-2.5 mb-1.5 rounded-lg border border-border bg-panel">
        <div class="flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px]">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed() ? (
              <ChevronRight size={13} />
            ) : (
              <ChevronDown size={13} />
            )}
            <FileDiff size={13} class="text-muted" />
            <span class="font-medium">Changes</span>
            <span class="text-muted">{sessionState().edits.length}</span>
          </button>
          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              class="rounded px-2 py-0.5 text-[11px] text-muted transition hover:bg-panel hover:text-foreground"
              title="Undo all changes"
              onClick={() => editAction("undoAll")}
            >
              Undo All
            </button>
            <button
              type="button"
              class="inline-flex items-center rounded-full bg-button px-2.5 py-0.5 text-[11px] font-medium text-button-foreground transition hover:bg-button-hover"
              title="Keep all changes"
              onClick={() => editAction("keepAll")}
            >
              Keep All
            </button>
          </div>
        </div>
        <Show when={!collapsed()}>
          <div class="max-h-40 overflow-y-auto px-2.5 pb-1.5 scroll-thin">
            <For each={sessionState().edits}>
              {(edit) => (
                <div class="group flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] transition-colors hover:bg-list-active-bg/35">
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-foreground/85 hover:text-accent hover:underline"
                    title={edit.path + (edit.created ? " (new file)" : "")}
                    onClick={() => editAction("diff", edit.path)}
                  >
                    {edit.name}
                    <Show when={edit.created}>
                      <span class="text-muted"> (new)</span>
                    </Show>
                  </button>
                  <span class="shrink-0 font-mono text-[10.5px] opacity-80 transition-opacity group-hover:opacity-100">
                    <span class="text-added">+{edit.adds}</span>{" "}
                    <span class="text-removed">-{edit.removes}</span>
                  </span>
                  <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      class="shrink-0 rounded p-1 text-muted hover:bg-panel hover:text-foreground"
                      title="Keep this change"
                      aria-label="Keep this change"
                      onClick={() => editAction("keep", edit.path)}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      class="shrink-0 rounded p-1 text-muted hover:bg-panel hover:text-foreground"
                      title={
                        edit.created
                          ? "Delete this new file"
                          : "Restore the original content"
                      }
                      aria-label={
                        edit.created
                          ? "Delete this new file"
                          : "Restore the original content"
                      }
                      onClick={() => editAction("undo", edit.path)}
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
