import { createMemo, For, Show } from "solid-js";
import { baseName, computeDiffLines } from "../lib/diff";
import { editAction } from "../store";

const MAX_LINES = 30;

const LINE_CLASS: Record<string, string> = {
  add: "bg-added/20",
  del: "bg-removed/20",
  ctx: "text-muted",
};

export default function DiffCard(props: {
  path: string;
  oldText: string | null;
  newText: string;
}) {
  const diff = createMemo(() => computeDiffLines(props.oldText, props.newText));
  const shown = createMemo(() => diff().lines.slice(0, MAX_LINES));
  const hiddenCount = createMemo(() => diff().lines.length - shown().length);

  return (
    <div class="mt-1 overflow-hidden rounded-md border border-border">
      <div class="flex items-center gap-2 border-b border-border bg-panel px-2.5 py-1.5">
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left text-[12px] text-accent hover:underline"
          title={`${props.path} — click to open the full diff`}
          onClick={() => editAction("diff", props.path)}
        >
          {baseName(props.path)}
        </button>
        <span class="shrink-0 font-mono text-[11px]">
          <span class="text-added">+{diff().adds}</span>{" "}
          <span class="text-removed">-{diff().removes}</span>
        </span>
      </div>
      <div class="max-h-64 overflow-auto font-mono text-[12px] leading-snug scroll-thin">
        <For each={shown()}>
          {(line) => (
            <div
              class={`whitespace-pre-wrap break-words px-2.5 ${LINE_CLASS[line.kind] ?? ""}`}
            >
              {(line.kind === "add"
                ? "+ "
                : line.kind === "del"
                  ? "- "
                  : "  ") + line.text}
            </div>
          )}
        </For>
        <Show when={hiddenCount() > 0}>
          <div class="px-2.5 py-0.5 italic text-muted">
            … {hiddenCount()} more lines
          </div>
        </Show>
      </div>
    </div>
  );
}
