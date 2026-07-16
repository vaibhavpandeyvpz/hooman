import { createMemo, For } from "solid-js";
import { baseName, computeDiffLines } from "../lib/diff";
import { editAction } from "../store";

const LINE_CLASS: Record<string, string> = {
  add: "bg-added/20",
  del: "bg-removed/20",
  ctx: "text-muted",
};

function lineNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

export default function DiffCard(props: {
  path: string;
  oldText: string | null;
  newText: string;
}) {
  const diff = createMemo(() => computeDiffLines(props.oldText, props.newText));

  return (
    <div class="mt-1 overflow-hidden rounded-md border border-border">
      <div class="flex items-center gap-2 border-b border-border bg-panel px-2.5 py-1.5">
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left text-[12px] text-accent hover:underline"
          title={`${props.path} — click to open this change in the full diff`}
          onClick={() =>
            editAction(
              "diff",
              props.path,
              diff().targetLine,
              props.oldText,
              props.newText,
            )
          }
        >
          {baseName(props.path)}
        </button>
        <span class="shrink-0 font-mono text-[11px]">
          <span class="text-added">+{diff().adds}</span>{" "}
          <span class="text-removed">-{diff().removes}</span>
        </span>
      </div>
      <div
        class="max-h-36 overflow-auto font-mono text-[12px] leading-snug scroll-thin"
        tabindex="0"
        aria-label={`Diff preview for ${baseName(props.path)}`}
      >
        <For each={diff().lines}>
          {(line) => (
            <div
              class={`grid grid-cols-[5ch_2ch_minmax(0,1fr)] whitespace-pre-wrap break-words px-2.5 ${LINE_CLASS[line.kind] ?? ""}`}
            >
              <span
                class="select-none text-right text-muted/70"
                aria-hidden="true"
              >
                {lineNumber(line.kind === "del" ? line.oldLine : line.newLine)}
              </span>
              <span class="select-none text-right" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
              </span>
              <span class="min-w-0 pl-1">{line.text}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
