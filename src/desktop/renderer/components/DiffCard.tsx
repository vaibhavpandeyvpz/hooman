import { useMemo } from "react";
import { baseName, computeDiffLines } from "../lib/diff.js";
import { cn } from "../lib/cn.js";

const LINE_CLASS: Record<string, string> = {
  add: "bg-hooman-success/10",
  del: "bg-hooman-error/10",
  ctx: "",
};

export function DiffCard({
  path,
  oldText,
  newText,
}: {
  path: string;
  oldText: string | null;
  newText: string;
}) {
  const diff = useMemo(
    () => computeDiffLines(oldText, newText),
    [oldText, newText],
  );

  return (
    <div className="mt-1 overflow-hidden rounded-md border border-slate-800">
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-2.5 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-left text-[12px] text-hooman-info"
          title={path}
        >
          {baseName(path)}
        </span>
        <span className="shrink-0 font-mono text-[11px]">
          <span className="text-hooman-success">+{diff.adds}</span>{" "}
          <span className="text-hooman-error">-{diff.removes}</span>
        </span>
      </div>
      <div className="max-h-36 overflow-auto font-mono text-[12px] leading-snug">
        {diff.lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[5ch_2ch_minmax(0,1fr)] whitespace-pre-wrap break-words px-2.5",
              LINE_CLASS[line.kind],
            )}
          >
            <span className="select-none text-right text-hooman-muted/70">
              {line.kind === "del" ? line.oldLine : line.newLine}
            </span>
            <span className="select-none text-right">
              {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
            </span>
            <span className="min-w-0 pl-1">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
