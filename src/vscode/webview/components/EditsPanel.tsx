import { createSignal, For, Show } from "solid-js";
import { ChevronDown, ChevronRight, FileDiff } from "lucide-solid";
import { editAction, state } from "../store";

export default function EditsPanel() {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <Show when={state.edits.length > 0}>
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
            <span class="text-muted">{state.edits.length}</span>
          </button>
          <div class="flex shrink-0 gap-1">
            <button
              type="button"
              class="rounded border border-button-border bg-button-secondary px-2 py-0.5 text-[11px] text-button-secondary-foreground hover:bg-button-secondary-hover"
              title="Keep all changes"
              onClick={() => editAction("keepAll")}
            >
              Keep All
            </button>
            <button
              type="button"
              class="rounded border border-button-border bg-button-secondary px-2 py-0.5 text-[11px] text-button-secondary-foreground hover:bg-button-secondary-hover"
              title="Undo all changes"
              onClick={() => editAction("undoAll")}
            >
              Undo All
            </button>
          </div>
        </div>
        <Show when={!collapsed()}>
          <div class="max-h-40 overflow-y-auto px-2.5 pb-1.5 scroll-thin">
            <For each={state.edits}>
              {(edit) => (
                <div class="flex items-center gap-2 py-0.5 text-[12.5px]">
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-accent hover:underline"
                    title={edit.path + (edit.created ? " (new file)" : "")}
                    onClick={() => editAction("diff", edit.path)}
                  >
                    {edit.name}
                    <Show when={edit.created}>
                      <span class="text-muted"> (new)</span>
                    </Show>
                  </button>
                  <span class="shrink-0 font-mono text-[11px]">
                    <span class="text-added">+{edit.adds}</span>{" "}
                    <span class="text-removed">-{edit.removes}</span>
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded border border-button-border bg-button-secondary px-2 py-0.5 text-[11px] text-button-secondary-foreground hover:bg-button-secondary-hover"
                    onClick={() => editAction("keep", edit.path)}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    class="shrink-0 rounded border border-button-border bg-button-secondary px-2 py-0.5 text-[11px] text-button-secondary-foreground hover:bg-button-secondary-hover"
                    title={
                      edit.created
                        ? "Delete this new file"
                        : "Restore the original content"
                    }
                    onClick={() => editAction("undo", edit.path)}
                  >
                    Undo
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
