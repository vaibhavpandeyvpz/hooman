import { createSignal, For, Show } from "solid-js";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Square,
  Terminal,
} from "lucide-solid";
import { sessionState, stopShellJob, state } from "../store";

/** Active background shell jobs strip above the composer. */
export default function BackgroundJobsBar() {
  const [collapsed, setCollapsed] = createSignal(false);
  const jobs = () => sessionState().shellJobs;
  const sessionId = () => state.activeSessionId;

  return (
    <Show when={jobs().length > 0}>
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
            <Terminal size={12} class="shrink-0 text-accent" />
            <span class="font-medium text-foreground">
              {jobs().length === 1
                ? "1 background terminal"
                : `${jobs().length} background terminals`}
            </span>
          </button>
        </div>
        <Show when={!collapsed()}>
          <div class="max-h-40 overflow-y-auto px-1.5 pb-1.5 scroll-thin">
            <For each={jobs()}>
              {(job) => {
                const stopping = () =>
                  Boolean(job.stopping) || job.status === "stopping";
                return (
                  <div class="group flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-list-active-bg hover:text-list-active-fg">
                    <Terminal size={12} class="shrink-0 text-muted" />
                    <span
                      class="min-w-0 flex-1 truncate"
                      title={`${job.description} (${job.jobId})`}
                    >
                      {job.description}
                    </span>
                    <span class="shrink-0 text-[11px] text-muted">
                      {stopping() ? "stopping" : job.status}
                    </span>
                    <button
                      type="button"
                      class={`btn-icon shrink-0 ${
                        stopping()
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      }`}
                      title={stopping() ? "Stopping…" : "Stop"}
                      aria-label={stopping() ? "Stopping" : "Stop"}
                      disabled={stopping()}
                      onClick={() => {
                        if (stopping()) {
                          return;
                        }
                        const sid = sessionId();
                        if (sid) {
                          stopShellJob(sid, job.jobId);
                        }
                      }}
                    >
                      <Show when={stopping()} fallback={<Square size={12} />}>
                        <Loader2 size={12} class="animate-spin-slow" />
                      </Show>
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
