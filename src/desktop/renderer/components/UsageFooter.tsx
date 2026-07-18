import type { TranscriptState } from "../../shared/session-types.js";
import { ArrowDown, ArrowUp, Coins, Database, Zap } from "lucide-react";
import { formatCostUsd, formatCount } from "../lib/format.js";
import { cn } from "../lib/cn.js";

/**
 * Per-turn token meter (in/cin/out/tok-s) plus session cost and a context-
 * window gauge — mirrors the CLI TUI and VS Code webview's `UsageFooter.tsx`.
 */
export function UsageFooter({ state }: { state: TranscriptState }) {
  const { turnUsage, cost, context } = state;
  if (!turnUsage && !cost && !context) return null;

  const contextRatio =
    context && context.size > 0 ? Math.min(1, context.used / context.size) : 0;
  const gaugeColor =
    contextRatio >= 0.9
      ? "bg-hooman-error"
      : contextRatio >= 0.7
        ? "bg-hooman-warning"
        : "bg-hooman-primary";
  const cachedTokens =
    (turnUsage?.cacheRead ?? 0) + (turnUsage?.cacheWrite ?? 0);

  return (
    <div className="mx-2.5 mb-1.5 flex items-center gap-3 font-mono text-[11px] tabular-nums text-hooman-muted">
      {turnUsage && (
        <>
          <span className="flex items-center gap-1" title="Input tokens">
            <ArrowUp size={11} />
            {formatCount(turnUsage.input)} in
          </span>
          {cachedTokens > 0 && (
            <span
              className="flex items-center gap-1"
              title="Cached input tokens"
            >
              <Database size={11} />
              {formatCount(cachedTokens)} cin
            </span>
          )}
          <span className="flex items-center gap-1" title="Output tokens">
            <ArrowDown size={11} />
            {formatCount(turnUsage.output)} out
          </span>
          {(turnUsage.tokensPerSecond ?? 0) > 0 && (
            <span className="flex items-center gap-1" title="Output tokens/sec">
              <Zap size={11} />
              {formatCount(Math.round(turnUsage.tokensPerSecond ?? 0))} tok/s
            </span>
          )}
        </>
      )}
      <span className="ml-auto flex items-center gap-3">
        {cost && (
          <span
            className="flex items-center gap-1"
            title={`Session cost (${cost.currency})`}
          >
            <Coins size={11} />
            {formatCostUsd(cost.amount)}
          </span>
        )}
        {context && (
          <span
            className="flex items-center gap-1.5"
            title={`Context window: ${formatCount(context.used)} of ${formatCount(context.size)} tokens (${Math.round(contextRatio * 100)}%)`}
          >
            <span className="h-[5px] w-12 overflow-hidden rounded-full border border-slate-800">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-300",
                  gaugeColor,
                )}
                style={{
                  width: `${Math.max(2, Math.round(contextRatio * 100))}%`,
                }}
              />
            </span>
            {Math.round(contextRatio * 100)}%
          </span>
        )}
      </span>
    </div>
  );
}
