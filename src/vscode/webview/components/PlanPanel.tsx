import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  ListChecks,
  SquareCheck,
} from "lucide-solid";
import { state } from "../store";

export default function PlanPanel() {
  const [collapsed, setCollapsed] = createSignal(false);
  const done = createMemo(
    () => state.plan.filter((entry) => entry.status === "completed").length,
  );
  const allDone = createMemo(
    () => state.plan.length > 0 && done() === state.plan.length,
  );

  // Auto-collapse once everything is done; the user can still re-expand it.
  createEffect(() => {
    if (allDone()) {
      setCollapsed(true);
    }
  });

  return (
    <Show when={state.plan.length > 0}>
      <div class="mx-2.5 mb-1.5 rounded-lg border border-border bg-panel">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12.5px]"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed() ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <ListChecks size={13} class="text-muted" />
          <span class="font-medium">Plan</span>
          <span class="ml-auto text-muted">
            {done()}/{state.plan.length}
          </span>
        </button>
        <Show when={!collapsed()}>
          <div class="max-h-40 overflow-y-auto px-2.5 pb-1.5 scroll-thin">
            <For each={state.plan}>
              {(entry) => (
                <div
                  class={`flex items-start gap-1.5 py-0.5 text-[12.5px] ${
                    entry.status === "completed"
                      ? "text-muted line-through"
                      : entry.status === "in_progress"
                        ? "font-medium"
                        : ""
                  }`}
                >
                  <span class="mt-0.5 shrink-0">
                    <Show
                      when={entry.status === "completed"}
                      fallback={
                        <Show
                          when={entry.status === "in_progress"}
                          fallback={<Circle size={13} class="text-muted" />}
                        >
                          <CircleDot size={13} class="text-accent" />
                        </Show>
                      }
                    >
                      <SquareCheck size={13} class="text-success" />
                    </Show>
                  </span>
                  <span>{entry.content}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
