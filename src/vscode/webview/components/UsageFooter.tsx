import { Show } from "solid-js";
import { ArrowDown, ArrowUp, Database } from "lucide-solid";
import { formatCount } from "../lib/format";
import { state } from "../store";

/**
 * Mirrors the CLI TUI's `in`/`cin`/`out` billing meter. The agent normalizes
 * usage to the additive shape before accumulating (providers disagree on
 * whether input includes cache reads), so `input` here is always only the
 * uncached portion and cached input (`cin`) is surfaced separately,
 * combining read + write.
 */
export default function UsageFooter() {
  return (
    <Show when={state.usage}>
      {(usage) => (
        <div class="mx-2.5 mb-1.5 flex items-center gap-3 text-[11px] text-muted font-mono tabular-nums">
          <span class="flex items-center gap-1" title="Input tokens">
            <ArrowUp size={11} />
            {formatCount(usage().input)} in
          </span>
          <Show when={(usage().cacheRead ?? 0) + (usage().cacheWrite ?? 0) > 0}>
            <span class="flex items-center gap-1" title="Cached input tokens">
              <Database size={11} />
              {formatCount(
                (usage().cacheRead ?? 0) + (usage().cacheWrite ?? 0),
              )}{" "}
              cin
            </span>
          </Show>
          <span class="flex items-center gap-1" title="Output tokens">
            <ArrowDown size={11} />
            {formatCount(usage().output)} out
          </span>
        </div>
      )}
    </Show>
  );
}
