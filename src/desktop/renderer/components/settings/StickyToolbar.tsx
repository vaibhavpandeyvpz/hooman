import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

/**
 * Pins a tab's action row (Add provider/LLM/MCP server, etc.) to the top of
 * the scrollable tab body, mirroring the sticky Settings header/tab bar
 * above it. Sits flush against the scroll container's top edge (the
 * container itself is unpadded — padding lives on the scrollable content
 * below instead) so there's no gap above it once scrolled.
 */
export function StickyToolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex justify-end border-b border-border bg-background px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
