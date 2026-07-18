import { useEffect, useState } from "react";
import { THINKING_VERBS } from "../lib/thinking-verbs.js";
import { formatClock } from "../lib/format.js";

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

/**
 * The three-dot "thinking" indicator + cycling status verb + elapsed clock
 * shown above the composer while a prompt turn is in flight — a React port
 * of the VS Code webview's `StatusStrip.tsx`.
 */
export function BusyIndicator({
  busy,
  startedAt,
}: {
  busy: boolean;
  startedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [verbIndex, setVerbIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_VERBS.length),
  );
  const [shimmerIndex, setShimmerIndex] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const clock = setInterval(() => setNow(Date.now()), 250);
    const verbTimer = setInterval(
      () => setVerbIndex((value) => pickVerbIndex(value)),
      1800,
    );
    const shimmerTimer = setInterval(
      () => setShimmerIndex((value) => (value + 1) % SHIMMER.length),
      900,
    );
    return () => {
      clearInterval(clock);
      clearInterval(verbTimer);
      clearInterval(shimmerTimer);
    };
  }, [busy]);

  if (!busy) return null;

  const elapsed = startedAt ? now - startedAt : 0;
  const label = THINKING_VERBS[verbIndex] ?? "Thinking";

  return (
    <div className="mb-1.5 flex items-center gap-2 text-[12px] text-hooman-muted">
      <span className="flex gap-0.5">
        <span className="animate-blip h-1.5 w-1.5 rounded-full bg-hooman-primary [animation-delay:0ms]" />
        <span className="animate-blip h-1.5 w-1.5 rounded-full bg-hooman-primary [animation-delay:180ms]" />
        <span className="animate-blip h-1.5 w-1.5 rounded-full bg-hooman-primary [animation-delay:360ms]" />
      </span>
      <span
        className="truncate transition-colors duration-[900ms]"
        style={{ color: SHIMMER[shimmerIndex] ?? "#0091cd" }}
      >
        {label}…
      </span>
      <span className="ml-auto font-mono tabular-nums">
        {formatClock(elapsed)}
      </span>
    </div>
  );
}
