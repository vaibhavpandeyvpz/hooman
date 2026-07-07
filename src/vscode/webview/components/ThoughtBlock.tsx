import { createEffect, createSignal, Show } from "solid-js";
import { ChevronDown, ChevronRight } from "lucide-solid";
import { formatDuration } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { thoughtTokenEstimate } from "../store";

export default function ThoughtBlock(props: {
  text: string;
  startedAt: number;
  finishedAt: number | null;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const isDone = () => props.finishedAt !== null;

  // Auto-collapse once the thought finishes streaming (mirrors the CLI
  // TUI's `reasoningDisplay: "collapsed"` default); the user can still
  // expand it again afterward.
  createEffect(() => {
    if (props.finishedAt !== null) {
      setExpanded(false);
    }
  });

  return (
    <div class="self-stretch border-l-2 border-muted/40 pl-2.5 text-[12.5px] text-muted">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 py-0.5 text-left hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Show
          when={isDone()}
          fallback={<span class="italic opacity-90">Thinking…</span>}
        >
          <span class="italic opacity-90">
            Thought for {formatDuration(props.finishedAt! - props.startedAt)}
            <span class="opacity-70">
              {" "}
              · ~{thoughtTokenEstimate(props.text).toLocaleString()} tokens
            </span>
          </span>
        </Show>
      </button>
      <Show when={expanded()}>
        <div class="mt-0.5 max-h-56 overflow-y-auto pb-1 scroll-thin">
          <Markdown class="break-words px-0.5 text-[12.5px] leading-relaxed text-muted">
            {props.text}
          </Markdown>
        </div>
      </Show>
    </div>
  );
}
