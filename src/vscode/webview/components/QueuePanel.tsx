import { createSignal, For, Show } from "solid-js";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clock,
  ListChecks,
  Paperclip,
  Pencil,
  Trash2,
} from "lucide-solid";
import {
  queueDeletePrompt,
  queueEditPrompt,
  queueSendNow,
  sessionState,
  steerQueue,
} from "../store";

/** Queued prompts submitted while a turn was running: FIFO by default, or drained into the active turn via "Steer". */
export default function QueuePanel() {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <Show when={sessionState().queue.length > 0}>
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
            <span class="font-medium">
              {sessionState().queue.length} Queued
            </span>
          </button>
          <button
            type="button"
            class="flex shrink-0 items-center gap-1 rounded border border-button-border bg-button-secondary px-2 py-0.5 text-[11px] text-button-secondary-foreground hover:bg-button-secondary-hover"
            title="Inject all queued prompts as guidance for the turn that's running now"
            onClick={() => steerQueue()}
          >
            <ListChecks size={11} />
            Steer now
          </button>
        </div>
        <Show when={!collapsed()}>
          <div class="max-h-40 overflow-y-auto px-1.5 pb-1.5 scroll-thin">
            <For each={sessionState().queue}>
              {(item) => (
                <div class="group flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-list-active-bg hover:text-list-active-fg">
                  <Clock size={12} class="shrink-0 text-muted" />
                  <span class="min-w-0 flex-1 truncate" title={item.text}>
                    {item.text || "(attachments only)"}
                  </span>
                  <Show when={item.attachments?.length}>
                    <span class="flex shrink-0 items-center gap-0.5 text-[11px] text-muted">
                      <Paperclip size={10} />
                      {item.attachments!.length}
                    </span>
                  </Show>
                  <div class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      class="rounded p-1 text-muted hover:bg-panel hover:text-foreground"
                      title="Edit"
                      onClick={() => queueEditPrompt(item.id)}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      class="rounded p-1 text-muted hover:bg-panel hover:text-foreground"
                      title="Send now"
                      onClick={() => queueSendNow(item.id)}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      class="rounded p-1 text-muted hover:bg-panel hover:text-removed"
                      title="Remove"
                      onClick={() => queueDeletePrompt(item.id)}
                    >
                      <Trash2 size={12} />
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
