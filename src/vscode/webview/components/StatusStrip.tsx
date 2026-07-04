import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { Square } from "lucide-solid";
import { formatClock } from "../lib/format";
import { cancelPrompt, state } from "../store";
import { THINKING_VERBS } from "../lib/thinking-verbs";

/** Cycling accent hues for the shimmering status label: cyan → sky → blue, matching the logo. */
const HUES = [187, 200, 217];

function pickVerbIndex(previous: number): number {
  if (THINKING_VERBS.length <= 1) return 0;
  let next = previous;
  while (next === previous) {
    next = Math.floor(Math.random() * THINKING_VERBS.length);
  }
  return next;
}

export default function StatusStrip() {
  const [now, setNow] = createSignal(Date.now());
  const [verbIndex, setVerbIndex] = createSignal(
    Math.floor(Math.random() * THINKING_VERBS.length),
  );
  const [hueIndex, setHueIndex] = createSignal(0);
  let clock: ReturnType<typeof setInterval> | undefined;
  let verbTimer: ReturnType<typeof setInterval> | undefined;
  let hueTimer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    if (state.busy && !clock) {
      clock = setInterval(() => setNow(Date.now()), 250);
    } else if (!state.busy && clock) {
      clearInterval(clock);
      clock = undefined;
    }
  });

  createEffect(() => {
    if (state.busy && !verbTimer) {
      verbTimer = setInterval(
        () => setVerbIndex((value) => pickVerbIndex(value)),
        1800,
      );
    } else if (!state.busy && verbTimer) {
      clearInterval(verbTimer);
      verbTimer = undefined;
    }
  });

  createEffect(() => {
    if (state.busy && !hueTimer) {
      hueTimer = setInterval(
        () => setHueIndex((value) => (value + 1) % HUES.length),
        900,
      );
    } else if (!state.busy && hueTimer) {
      clearInterval(hueTimer);
      hueTimer = undefined;
    }
  });

  onCleanup(() => {
    clock && clearInterval(clock);
    verbTimer && clearInterval(verbTimer);
    hueTimer && clearInterval(hueTimer);
  });

  const elapsed = createMemo(() => {
    void now();
    return state.promptStartedAt ? Date.now() - state.promptStartedAt : 0;
  });

  const activityLabel = createMemo(() => THINKING_VERBS[verbIndex()]);

  const shimmerStyle = createMemo(() => ({
    color: `hsl(${HUES[hueIndex()]}, 85%, 65%)`,
    transition: "color 0.9s ease-in-out",
  }));

  return (
    <Show when={state.busy}>
      <div class="mx-2.5 mb-1.5 flex items-center gap-2 text-[12px] text-muted">
        <span class="flex gap-0.5">
          <span class="animate-blip h-1.5 w-1.5 rounded-full bg-accent [animation-delay:0ms]" />
          <span class="animate-blip h-1.5 w-1.5 rounded-full bg-accent [animation-delay:180ms]" />
          <span class="animate-blip h-1.5 w-1.5 rounded-full bg-accent [animation-delay:360ms]" />
        </span>
        <span class="truncate" style={shimmerStyle()}>
          {activityLabel()}…
        </span>
        <span class="ml-auto font-mono tabular-nums">
          {formatClock(elapsed())}
        </span>
        <button
          type="button"
          class="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-panel"
          title="Stop the current turn"
          onClick={() => cancelPrompt()}
        >
          <Square size={9} fill="currentColor" />
          Stop
        </button>
      </div>
    </Show>
  );
}
