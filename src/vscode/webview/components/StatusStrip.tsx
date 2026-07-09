import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { formatClock } from "../lib/format";
import { sessionState } from "../store";
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
    if (sessionState().busy && !clock) {
      clock = setInterval(() => setNow(Date.now()), 250);
    } else if (!sessionState().busy && clock) {
      clearInterval(clock);
      clock = undefined;
    }
  });

  createEffect(() => {
    if (sessionState().busy && !verbTimer) {
      verbTimer = setInterval(
        () => setVerbIndex((value) => pickVerbIndex(value)),
        1800,
      );
    } else if (!sessionState().busy && verbTimer) {
      clearInterval(verbTimer);
      verbTimer = undefined;
    }
  });

  createEffect(() => {
    if (sessionState().busy && !hueTimer) {
      hueTimer = setInterval(
        () => setHueIndex((value) => (value + 1) % HUES.length),
        900,
      );
    } else if (!sessionState().busy && hueTimer) {
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
    const startedAt = sessionState().promptStartedAt;
    return startedAt ? Date.now() - startedAt : 0;
  });

  const activityLabel = createMemo(
    () => THINKING_VERBS[verbIndex()] ?? "Thinking",
  );

  const shimmerStyle = createMemo(() => ({
    color: `hsl(${HUES[hueIndex()]}, 85%, 65%)`,
    transition: "color 0.9s ease-in-out",
  }));

  return (
    <Show when={sessionState().busy}>
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
      </div>
    </Show>
  );
}
