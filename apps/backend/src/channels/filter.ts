import type { FilterMode } from "../types.js";

/**
 * Generic channel filter: returns true if the message should be processed.
 * Each adapter provides a channel-specific `matchFn` that checks whether
 * a normalised filter-list entry matches the current message context.
 */
export function applyFilter(
  config: { filterMode?: FilterMode; filterList?: string[] },
  matchFn: (entry: string) => boolean,
): boolean {
  const mode = config.filterMode ?? "all";
  if (mode === "all") return true;
  const list = (config.filterList ?? []).map((x) => x.trim());
  const match = list.some(matchFn);
  return mode === "allowlist" ? match : !match;
}
