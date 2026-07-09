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

/** Cycling brand accents for the shimmering status label: primary → secondary → info. */
const SHIMMER = ["#0091cd", "#56a0d3", "#c4dff6"];

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
  const [shimmerIndex, setShimmerIndex] = createSignal(0);
  let clock: ReturnType<typeof setInterval> | undefined;
  let verbTimer: ReturnType<typeof setInterval> | undefined;
  let shimmerTimer: ReturnType<typeof setInterval> | undefined;

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
    if (sessionState().busy && !shimmerTimer) {
      shimmerTimer = setInterval(
        () => setShimmerIndex((value) => (value + 1) % SHIMMER.length),
        900,
      );
    } else if (!sessionState().busy && shimmerTimer) {
      clearInterval(shimmerTimer);
      shimmerTimer = undefined;
    }
  });

  onCleanup(() => {
    clock && clearInterval(clock);
    verbTimer && clearInterval(verbTimer);
    shimmerTimer && clearInterval(shimmerTimer);
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
    color: SHIMMER[shimmerIndex()] ?? "#0091cd",
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
