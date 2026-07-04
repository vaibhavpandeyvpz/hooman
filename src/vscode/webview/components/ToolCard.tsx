import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  LoaderCircle,
  Wrench,
  X,
} from "lucide-solid";
import type { ToolCallStatusUi, TranscriptItem } from "../store";
import { toolDetailText, toolInputText, truncate } from "../lib/tool-format";
import DiffCard from "./DiffCard";

const STATUS_CLASS: Record<ToolCallStatusUi, string> = {
  pending: "text-muted",
  in_progress: "text-accent",
  completed: "text-success",
  failed: "text-error",
};

function StatusIcon(props: { status: ToolCallStatusUi }) {
  return (
    <Show
      when={props.status === "in_progress"}
      fallback={
        <Show
          when={props.status === "completed"}
          fallback={
            <Show
              when={props.status === "failed"}
              fallback={<Circle size={13} />}
            >
              <X size={13} />
            </Show>
          }
        >
          <Check size={13} />
        </Show>
      }
    >
      <LoaderCircle size={13} class="animate-spin-slow" />
    </Show>
  );
}

export default function ToolCard(props: {
  item: Extract<TranscriptItem, { kind: "tool" }>;
}) {
  const [outputOpen, setOutputOpen] = createSignal(false);
  const diffs = createMemo(() =>
    props.item.content.filter((c) => c.type === "diff"),
  );
  const hasInput = createMemo(
    () => diffs().length === 0 && toolInputText(props.item.rawInput).length > 0,
  );
  const detail = createMemo(() => toolDetailText(props.item.content));

  // Keep the output expanded while streaming live terminal output or when
  // the tool failed; otherwise leave collapse state to the user.
  const forceOpen = createMemo(
    () => props.item.live || props.item.status === "failed",
  );

  let detailRef: HTMLDivElement | undefined;
  createEffect(() => {
    // Track dependencies before the guard so live-output growth keeps re-running this.
    const text = detail();
    if (props.item.live && detailRef) {
      void text;
      detailRef.scrollTop = detailRef.scrollHeight;
    }
  });

  return (
    <div
      class={`self-stretch rounded-md border px-2.5 py-1.5 text-[12.5px] ${
        props.item.status === "failed" ? "border-error/40" : "border-border"
      }`}
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class={STATUS_CLASS[props.item.status]}>
          <StatusIcon status={props.item.status} />
        </span>
        <Wrench size={13} class="shrink-0 text-muted" />
        <span class="min-w-0 flex-1 truncate">{props.item.title}</span>
      </div>
      <Show when={hasInput()}>
        <div class="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-code-bg px-2 py-1 font-mono text-[11.5px] scroll-thin">
          {truncate(toolInputText(props.item.rawInput), 600)}
        </div>
      </Show>
      <Show when={diffs().length > 0}>
        <div class="flex flex-col gap-1.5">
          <For each={diffs()}>
            {(d) =>
              d.type === "diff" ? (
                <DiffCard
                  path={d.path}
                  oldText={d.oldText ?? null}
                  newText={d.newText}
                />
              ) : null
            }
          </For>
        </div>
      </Show>
      <Show when={detail().length > 0}>
        <div class="mt-1">
          <button
            type="button"
            class="flex items-center gap-1 text-[11.5px] text-muted hover:text-foreground"
            onClick={() => setOutputOpen((v) => !v)}
          >
            {outputOpen() || forceOpen() ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            Output
          </button>
          <Show when={outputOpen() || forceOpen()}>
            <div
              ref={detailRef}
              class="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-muted scroll-thin"
            >
              {truncate(detail(), 4000)}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
