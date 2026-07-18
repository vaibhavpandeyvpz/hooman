import { cn } from "../lib/cn.js";

const HEIGHTS = [4, 6, 8, 10];

/** 4-bar gauge glyph for reasoning-effort level (0-4 filled bars). */
export function EffortGauge({
  bars,
  className,
}: {
  bars: number;
  className?: string;
}) {
  return (
    <span className={cn("flex items-end gap-[1.5px]", className)}>
      {HEIGHTS.map((h, i) => (
        <span
          key={h}
          className={cn(
            "w-[2.5px] rounded-[1px] bg-current",
            i >= bars && "opacity-25",
          )}
          style={{ height: `${h}px` }}
        />
      ))}
    </span>
  );
}
