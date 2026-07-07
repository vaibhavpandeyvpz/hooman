import { Show } from "solid-js";
import { ArrowDown, ArrowUp, Coins, Database, Zap } from "lucide-solid";
import { formatCostUsd, formatCount } from "../lib/format";
import { sessionState } from "../store";

/**
 * Mirrors the CLI TUI's per-turn `in`/`cin`/`out` token meter: the latest
 * request's tokens, not a session running total (the context gauge already
 * reflects overall window usage). The agent normalizes usage to the additive
 * shape (providers disagree on whether input includes cache reads), so `input`
 * here is always only the uncached portion and cached input (`cin`) is
 * surfaced separately, combining read + write.
 *
 * When the agent resolved the model's billing metadata (config `billing`
 * block / models.dev), the right side adds a context-window gauge
 * (`usage_update.used`/`size`) and the cumulative session cost
 * (`usage_update.cost`). Both stay hidden while unresolved.
 */
export default function UsageFooter() {
  const contextRatio = () => {
    const context = sessionState().context;
    return context && context.size > 0
      ? Math.min(1, context.used / context.size)
      : 0;
  };
  const gaugeColor = () => {
    const ratio = contextRatio();
    if (ratio >= 0.9) {
      return "var(--color-error)";
    }
    if (ratio >= 0.7) {
      return "var(--color-warning)";
    }
    return "var(--color-accent)";
  };
  return (
    <Show when={sessionState().usage}>
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
          <Show when={(usage().tokensPerSecond ?? 0) > 0}>
            <span
              class="flex items-center gap-1"
              title="Output tokens/sec (latest request)"
            >
              <Zap size={11} />
              {formatCount(Math.round(usage().tokensPerSecond ?? 0))} tok/s
            </span>
          </Show>
          <span class="ml-auto flex items-center gap-3">
            <Show when={sessionState().cost}>
              {(cost) => (
                <span
                  class="flex items-center gap-1"
                  title={`Session cost (${cost().currency})`}
                >
                  <Coins size={11} />
                  {formatCostUsd(cost().amount)}
                </span>
              )}
            </Show>
            <Show when={sessionState().context}>
              {(context) => (
                <span
                  class="flex items-center gap-1.5"
                  title={`Context window: ${formatCount(context().used)} of ${formatCount(context().size)} tokens (${Math.round(contextRatio() * 100)}%)`}
                >
                  <span class="h-[5px] w-12 overflow-hidden rounded-full border border-border">
                    <span
                      class="block h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${Math.max(2, Math.round(contextRatio() * 100))}%`,
                        background: gaugeColor(),
                      }}
                    />
                  </span>
                  {Math.round(contextRatio() * 100)}%
                </span>
              )}
            </Show>
          </span>
        </div>
      )}
    </Show>
  );
}
