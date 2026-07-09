import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  type Component,
} from "solid-js";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  Cpu,
  Edit3,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-solid";
import { state } from "../store";
import { Markdown } from "../lib/markdown";
import { parsePlanText, type PlanTaskItem } from "../lib/plan-render";
import { post } from "../lib/vscode-api";

type IconComponent = Component<{ size?: number; class?: string }>;

export default function PlanEditorView() {
  const parsed = createMemo(() =>
    parsePlanText(state.planView?.text ?? "", state.planView?.name ?? "Plan"),
  );
  const [buildOpen, setBuildOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;

  // Close the build menu when clicking outside of it. A transparent full-screen
  // overlay would sit above the menu (it paints in the root stacking context)
  // and swallow the item clicks, so use a document listener that ignores
  // clicks inside the menu instead.
  createEffect(() => {
    if (!buildOpen()) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef && !menuRef.contains(event.target as Node)) {
        setBuildOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    onCleanup(() => document.removeEventListener("mousedown", onPointerDown));
  });

  const buildDisabled = createMemo(() => state.planView?.busy ?? false);

  function triggerBuild() {
    if (buildDisabled()) return;
    setBuildOpen(false);
    post({ type: "build" });
  }

  function triggerEditMarkdown() {
    setBuildOpen(false);
    post({ type: "editMarkdown" });
  }

  function triggerRefresh() {
    setBuildOpen(false);
    post({ type: "refresh" });
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--vscode-editor-background)] text-foreground">
      {/* Header */}
      <header class="shrink-0 border-b border-border bg-[var(--vscode-sideBar-background)] px-5 py-3">
        {/* Title + actions */}
        <div class="flex items-center justify-between gap-5">
          <div class="min-w-0 flex-1">
            <h1 class="truncate text-xl font-semibold leading-tight tracking-tight text-foreground">
              {parsed().title}
            </h1>
            <Show when={parsed().overview}>
              <p class="mt-0.5 max-w-3xl text-xs leading-5 text-muted">
                {parsed().overview}
              </p>
            </Show>
          </div>

          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {/* Model picker */}
            <Show
              when={
                state.planView?.modelLabel &&
                state.planView.modelLabel !== "Model"
              }
            >
              <button
                type="button"
                class="group flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11.5px] text-muted transition hover:bg-panel"
                onClick={() => post({ type: "pickModel" })}
                title="Choose model"
              >
                <Cpu size={12} class="text-accent" />
                <span class="max-w-[9em] truncate">
                  {state.planView?.modelLabel}
                </span>
                <ChevronDown size={11} class="opacity-60" />
              </button>
            </Show>

            {/* Build + menu */}
            <div ref={menuRef} class="relative flex items-center">
              <button
                type="button"
                disabled={buildDisabled()}
                class="btn btn-primary h-7 !rounded-r-none gap-1.5 px-2.5 text-[11.5px]"
                onClick={triggerBuild}
                title="Build this plan now"
              >
                <Show
                  when={state.planView?.busy}
                  fallback={<Play size={12} fill="currentColor" />}
                >
                  <Loader2 size={12} class="animate-spin-slow" />
                </Show>
                <span>Build</span>
              </button>
              <button
                type="button"
                disabled={buildDisabled()}
                class="btn btn-primary h-7 !rounded-l-none border-l border-button-foreground/15 !px-1.5"
                onClick={() => setBuildOpen((v) => !v)}
                title="More build actions"
                aria-haspopup="true"
                aria-expanded={buildOpen()}
              >
                <ChevronDown
                  size={11}
                  class={`opacity-80 transition-transform ${buildOpen() ? "rotate-180" : ""}`}
                />
              </button>

              <Show when={buildOpen()}>
                <div class="absolute right-0 top-full z-50 mt-1.5 max-h-56 min-w-[11em] overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-lg scroll-thin">
                  <DropdownItem
                    icon={Play}
                    label="Build now"
                    onClick={triggerBuild}
                  />
                  <DropdownItem
                    icon={Edit3}
                    label="Edit markdown"
                    onClick={triggerEditMarkdown}
                  />
                  <DropdownItem
                    icon={RefreshCw}
                    label="Refresh view"
                    onClick={triggerRefresh}
                  />
                </div>
              </Show>
            </div>
          </div>
        </div>

        {/* Status pills */}
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <Show when={state.planView?.dirty}>
            <StatusPill
              icon={Circle}
              label="Unsaved changes"
              variant="warning"
            />
          </Show>
        </div>
      </header>

      {/* Content */}
      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div class="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
          <main class="min-w-0 flex-1">
            {/* Empty plan */}
            <Show
              when={state.planView?.text.trim()}
              fallback={
                <div class="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-panel/30 py-20 text-center">
                  <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-panel">
                    <FileText size={22} class="text-muted" />
                  </div>
                  <h3 class="text-base font-medium text-foreground">
                    Plan is empty
                  </h3>
                  <p class="mt-1 max-w-xs text-sm text-muted">
                    Add goals and tasks in Markdown, then build to turn them
                    into action.
                  </p>
                  <button
                    type="button"
                    class="btn btn-primary mt-5 gap-2 px-3 py-1.5 text-sm"
                    onClick={() => post({ type: "editMarkdown" })}
                  >
                    <Edit3 size={14} />
                    Edit markdown
                  </button>
                </div>
              }
            >
              {/* Structured plan overview */}
              <Show when={parsed().structured}>
                <section class="mb-6 hidden rounded-lg border border-border/80 bg-panel/40 p-5 lg:block">
                  <div class="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles size={15} class="text-accent" />
                    Plan overview
                  </div>
                  <Show when={parsed().overview}>
                    <p class="mb-4 text-sm leading-6 text-muted">
                      {parsed().overview}
                    </p>
                  </Show>
                  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <StatBox
                      label="Tasks"
                      value={String(parsed().tasks.length)}
                    />
                    <StatBox
                      label="Done"
                      value={String(
                        parsed().tasks.filter((t) =>
                          isStatus(t.status, "completed"),
                        ).length,
                      )}
                    />
                    <StatBox
                      label="In progress"
                      value={String(
                        parsed().tasks.filter((t) =>
                          isStatus(t.status, "in_progress"),
                        ).length,
                      )}
                    />
                  </div>
                </section>
              </Show>

              {/* Raw markdown remainder */}
              <Show when={parsed().rawRemainder || !parsed().structured}>
                <article class="rounded-lg border border-border/80 bg-panel/35 p-6">
                  <Markdown class="text-[14px] leading-7 text-[var(--vscode-editor-foreground)]">
                    {parsed().rawRemainder || state.planView?.text || ""}
                  </Markdown>
                </article>
              </Show>
            </Show>
          </main>

          {/* Task checklist sidebar */}
          <Show when={parsed().tasks.length > 0}>
            <aside class="w-full shrink-0 lg:w-[22rem]">
              <div class="sticky top-0 rounded-lg border border-border/80 bg-panel/50 p-5 shadow-sm">
                <div class="mb-4 flex items-center justify-between">
                  <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <CheckCircle2 size={15} class="text-accent" />
                    Plan checklist
                  </div>
                  <span class="text-xs text-muted">
                    {
                      parsed().tasks.filter((t) =>
                        isStatus(t.status, "completed"),
                      ).length
                    }
                    {" / "}
                    {parsed().tasks.length}
                  </span>
                </div>

                {/* Progress bar */}
                <div class="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                  <div
                    class="h-full rounded-full bg-accent transition-all"
                    style={{
                      width: `${Math.round(
                        (parsed().tasks.filter((t) =>
                          isStatus(t.status, "completed"),
                        ).length /
                          parsed().tasks.length) *
                          100,
                      )}%`,
                    }}
                  />
                </div>

                <div class="space-y-2">
                  <For each={parsed().tasks}>
                    {(task) => <TaskRow task={task} />}
                  </For>
                </div>
              </div>
            </aside>
          </Show>
        </div>
      </div>
    </div>
  );
}

function DropdownItem(props: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-list-hover-bg hover:text-list-hover-fg"
      onClick={props.onClick}
    >
      <Icon size={13} class="text-muted" />
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}

function StatusPill(props: {
  icon: IconComponent;
  label: string;
  variant: "neutral" | "active" | "warning" | "success" | "error";
  spinning?: boolean;
}) {
  const Icon = props.icon;
  const variantClasses = {
    neutral: "border-border bg-panel/70 text-muted",
    active: "border-primary/30 bg-primary/10 text-primary",
    warning: "border-warning/30 bg-warning-bg text-warning",
    success: "border-success/30 bg-success/10 text-success",
    error: "border-error/30 bg-error/10 text-error",
  };

  return (
    <span
      class={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${variantClasses[props.variant]}`}
    >
      <Icon size={12} class={props.spinning ? "animate-spin-slow" : ""} />
      {props.label}
    </span>
  );
}

function StatBox(props: { label: string; value: string }) {
  return (
    <div class="rounded-md border border-border/60 bg-[var(--vscode-editor-background)] px-3 py-2.5 text-center">
      <div class="text-lg font-semibold leading-none text-foreground">
        {props.value}
      </div>
      <div class="mt-1 text-[11px] uppercase tracking-wide text-muted">
        {props.label}
      </div>
    </div>
  );
}

function TaskRow(props: { task: PlanTaskItem }) {
  const status = normalizeStatus(props.task.status);
  return (
    <div class="group flex items-start gap-3 rounded-md border border-border/60 bg-[var(--vscode-editor-background)] px-3 py-3 transition hover:border-border">
      <div class="mt-0.5 shrink-0">
        <Switch>
          <Match when={status === "completed"}>
            <CheckCircle2 size={16} class="text-success" />
          </Match>
          <Match when={status === "in_progress"}>
            <CircleDot size={16} class="text-accent" />
          </Match>
          <Match when={status === "blocked" || status === "error"}>
            <AlertCircle size={16} class="text-warning" />
          </Match>
          <Match when={status === "pending"}>
            <Circle size={16} class="text-muted" />
          </Match>
        </Switch>
      </div>
      <div class="min-w-0 flex-1">
        <div
          class={`text-sm leading-5 ${
            status === "completed"
              ? "text-muted line-through"
              : "text-foreground"
          }`}
        >
          {props.task.description}
        </div>
        <Show when={props.task.status}>
          <div class="mt-1 text-[11px] capitalize text-muted">
            {formatStatusLabel(props.task.status!)}
          </div>
        </Show>
      </div>
    </div>
  );
}

function normalizeStatus(
  status: string | undefined,
): "pending" | "in_progress" | "completed" | "blocked" | "error" {
  if (!status) return "pending";
  const s = status.toLowerCase().replace(/[-\s_]/g, "");
  if (
    s === "done" ||
    s === "complete" ||
    s === "completed" ||
    s === "finished"
  ) {
    return "completed";
  }
  if (
    s === "inprogress" ||
    s === "progress" ||
    s === "active" ||
    s === "started" ||
    s === "doing"
  ) {
    return "in_progress";
  }
  if (s === "blocked" || s === "stuck" || s === "failed" || s === "error") {
    return s === "failed" || s === "error" ? "error" : "blocked";
  }
  return "pending";
}

function isStatus(
  status: string | undefined,
  target: "pending" | "in_progress" | "completed" | "blocked" | "error",
): boolean {
  return normalizeStatus(status) === target;
}

function formatStatusLabel(status: string): string {
  return status.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
