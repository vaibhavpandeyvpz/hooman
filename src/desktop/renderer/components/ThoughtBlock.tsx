import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Markdown } from "../lib/markdown.js";

/**
 * Collapsible reasoning block, visually distinct from the final answer.
 * Auto-collapses once the thought is no longer the most recent item (i.e.
 * the model has moved on to tool calls or its final answer) — mirrors the
 * CLI TUI / VS Code webview's default collapsed reasoning display.
 */
export function ThoughtBlock({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!active) setExpanded(false);
  }, [active]);

  return (
    <div className="self-stretch border-l-2 border-hooman-muted/40 pl-2.5 text-[12.5px] text-hooman-muted">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 py-0.5 text-left hover:text-slate-100"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="italic opacity-90">
          {active ? "Thinking…" : "Thought"}
        </span>
      </button>
      {expanded && (
        <div className="mt-0.5 max-h-56 overflow-y-auto pb-1">
          <Markdown
            className="break-words px-0.5 text-[12.5px] leading-relaxed text-hooman-muted"
            text={text}
          />
        </div>
      )}
    </div>
  );
}
