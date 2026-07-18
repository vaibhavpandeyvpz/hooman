import { useEffect, useRef } from "react";
import type { TranscriptState } from "../../shared/session-types.js";
import { Terminal } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Markdown } from "../lib/markdown.js";
import { ThoughtBlock } from "./ThoughtBlock.js";
import { DiffCard } from "./DiffCard.js";

/**
 * `sessionId`/`scrollToken` changes force a smooth scroll-to-bottom even if
 * the user had scrolled up (opening a chat, sending a prompt); `state`
 * changes alone only stick to the bottom when already near it, so streamed
 * text and tool output don't fight manual scrollback. Mirrors the VS Code
 * webview's `Transcript.tsx`.
 */
export function Transcript({
  state,
  sessionId,
  scrollToken,
}: {
  state: TranscriptState;
  sessionId: string | null;
  scrollToken: number;
}) {
  const lastIndex = state.items.length - 1;
  const containerRef = useRef<HTMLDivElement>(null);

  const isNearBottom = () => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const scrollToBottom = (behavior: ScrollBehavior) => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior,
    });
  };

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToBottom("smooth"));
    });
    return () => cancelAnimationFrame(raf);
  }, [sessionId, scrollToken]);

  useEffect(() => {
    if (isNearBottom()) scrollToBottom("auto");
  }, [state]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
    >
      {state.plan.length > 0 && (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-[13px]">
          <div className="mb-1 font-medium text-hooman-info">Plan</div>
          <ul className="space-y-1">
            {state.plan.map((entry, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    entry.status === "completed" && "bg-hooman-success",
                    entry.status === "in_progress" && "bg-hooman-warning",
                    entry.status === "pending" && "bg-hooman-muted",
                  )}
                />
                <span
                  className={
                    entry.status === "completed"
                      ? "line-through text-hooman-muted"
                      : ""
                  }
                >
                  {entry.content}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.items.map((item, i) => {
        if (item.kind === "message") {
          if (item.role === "thought") {
            return (
              <ThoughtBlock
                key={`${item.id}-thought`}
                text={item.text}
                active={i === lastIndex}
              />
            );
          }
          return (
            <div
              key={`${item.id}-${item.role}`}
              className={cn(
                "max-w-[85%] rounded-md px-3 py-2 text-[13px]",
                item.role === "user" &&
                  "ml-auto bg-hooman-primary text-white whitespace-pre-wrap",
                item.role === "assistant" &&
                  "bg-slate-900 border border-slate-800",
              )}
            >
              {item.role === "assistant" ? (
                <Markdown text={item.text} />
              ) : (
                item.text
              )}
            </div>
          );
        }
        return (
          <div
            key={item.id}
            className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-[13px]"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  item.status === "completed" && "bg-hooman-success",
                  item.status === "failed" && "bg-hooman-error",
                  item.status === "in_progress" && "bg-hooman-warning",
                  item.status === "pending" && "bg-hooman-muted",
                )}
              />
              <span className="font-medium">{item.title}</span>
              {item.toolKind && (
                <span className="text-hooman-muted">· {item.toolKind}</span>
              )}
              {item.terminalIds.length > 0 && (
                <span
                  className="flex items-center gap-1 text-hooman-muted"
                  title="Ran in a terminal"
                >
                  <Terminal size={11} />
                </span>
              )}
            </div>
            {item.outputText && (
              <pre className="mt-1.5 max-h-40 overflow-y-auto rounded bg-black/40 p-2 text-[12px] text-hooman-muted">
                {item.outputText}
              </pre>
            )}
            {item.diffs.map((diff) => (
              <DiffCard
                key={diff.path}
                path={diff.path}
                oldText={diff.oldText}
                newText={diff.newText}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
