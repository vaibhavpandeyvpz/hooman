import { For, Show } from "solid-js";
import { Loader2, Plus, X } from "lucide-solid";
import { activateTab, closeTab, newChatFromPanel, state } from "../store";

export default function TabStrip() {
  return (
    <div class="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1.5">
      <div class="scroll-thin flex min-w-0 flex-1 gap-1 overflow-x-auto">
        <For each={state.tabs}>
          {(tab) => {
            const active = () => state.activeSessionId === tab.sessionId;
            return (
              <button
                type="button"
                class={`group flex min-w-0 max-w-56 items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] ${
                  active()
                    ? "border-accent bg-panel text-foreground"
                    : "border-button-border bg-button-secondary text-muted hover:bg-button-secondary-hover hover:text-foreground"
                }`}
                title={tab.title}
                onClick={() => activateTab(tab.sessionId)}
              >
                <Show
                  when={tab.busy}
                  fallback={
                    <span class="h-2 w-2 shrink-0 rounded-full bg-muted/70" />
                  }
                >
                  <Loader2
                    size={11}
                    class="shrink-0 animate-spin text-accent"
                  />
                </Show>
                <span class="min-w-0 flex-1 truncate text-left">
                  {tab.title}
                </span>
                <Show when={tab.unread}>
                  <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
                    title="Unread background activity"
                  />
                </Show>
                <Show when={(tab.pendingPermissions ?? 0) > 0}>
                  <span
                    class="shrink-0 rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-medium text-black"
                    title={`${tab.pendingPermissions} pending permission prompt${(tab.pendingPermissions ?? 0) === 1 ? "" : "s"}`}
                  >
                    {tab.pendingPermissions}
                  </span>
                </Show>
                <span
                  class="shrink-0 rounded p-0.5 text-muted hover:bg-panel hover:text-foreground"
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
      <button
        type="button"
        class="shrink-0 rounded border border-button-border bg-button-secondary p-1 text-button-secondary-foreground hover:bg-button-secondary-hover"
        title="New chat tab"
        onClick={() => newChatFromPanel()}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
