/** Compact human count, e.g. 12_345 -> "12.3k", 1_200_000 -> "1.2M". Mirrors the CLI TUI's `millify` usage. */
export function formatCount(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) {
    return String(value);
  }
  const units: Array<[number, string]> = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "k"],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      const scaled = value / threshold;
      const rounded =
        scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
      return `${rounded}${suffix}`;
    }
  }
  return String(value);
}

/** "12s", "1m 05s" — elapsed duration for the busy timer / thought summary. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** "MM:SS" elapsed clock for the live busy timer. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Rough token estimate for reasoning text the model doesn't report usage for, same heuristic as the CLI TUI (chars / 4). */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / 4));
}

/** Compact "5m ago"-style timestamp for session rows. */
export function formatRelativeTime(iso: string): string | undefined {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return undefined;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(then).toLocaleDateString();
}

/** Bucket an ISO timestamp into a history group label. */
export function dateGroupLabel(iso: string | undefined): string {
  if (!iso) {
    return "Older";
  }
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return "Older";
  }
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const day = startOfDay(then);
  const dayMs = 24 * 60 * 60 * 1000;
  if (day >= today) {
    return "Today";
  }
  if (day >= today - dayMs) {
    return "Yesterday";
  }
  if (day >= today - 7 * dayMs) {
    return "Last 7 Days";
  }
  return "Older";
}
