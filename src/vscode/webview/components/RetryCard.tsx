import { createSignal, Show } from "solid-js";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-solid";
import { formatDuration } from "../lib/format";

export default function RetryCard(props: {
  retryInSeconds: number;
  attempt: number;
  maxAttempts: number;
  error: string;
  errorDetail?: string;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const detail = () => props.errorDetail?.trim() || props.error.trim();

  return (
    <div class="self-stretch rounded-md border border-warning/40 bg-warning-bg px-2.5 py-1.5 text-[12.5px] text-muted">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 text-left hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <AlertTriangle size={13} class="shrink-0 text-warning" />
        <span class="italic opacity-90">
          Request failed · retrying in{" "}
          {formatDuration(props.retryInSeconds * 1000)}
          <span class="opacity-70">
            {" "}
            · attempt {props.attempt}/{props.maxAttempts}
          </span>
        </span>
      </button>
      <Show when={expanded() && detail().length > 0}>
        <div class="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-muted scroll-thin">
          {detail()}
        </div>
      </Show>
    </div>
  );
}
