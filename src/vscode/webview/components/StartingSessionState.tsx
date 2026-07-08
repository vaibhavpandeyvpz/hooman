import { For } from "solid-js";
import { Loader2 } from "lucide-solid";
import HoomanLogo from "./HoomanLogo";

const SKELETON_WIDTHS = ["w-full", "w-[88%]", "w-[76%]"];

export default function StartingSessionState() {
  return (
    <div class="m-auto flex w-full max-w-[26rem] flex-col items-center gap-5 px-6 py-8">
      <div class="relative flex flex-col items-center gap-2.5">
        <div class="absolute -top-4 h-24 w-24 rounded-full bg-accent opacity-[0.07] blur-2xl" />
        <HoomanLogo class="h-12 w-12 text-accent opacity-90" />
        <div class="text-center">
          <h2 class="inline-flex items-center gap-1.5 text-[16px] font-semibold text-foreground">
            <span>Starting session…</span>
            <Loader2 size={14} class="animate-spin text-accent" />
          </h2>
          <p class="text-[12.5px] text-muted">
            Bootstrapping agent and MCP servers, if any.
          </p>
        </div>
      </div>

      <div class="flex w-full flex-col gap-2 rounded-xl border border-border bg-panel px-4 py-3">
        <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          Preparing your chat
        </div>
        <For each={SKELETON_WIDTHS}>
          {(width) => (
            <div
              class={`h-3 animate-pulse rounded bg-[var(--vscode-editor-inactiveSelectionBackground,var(--vscode-list-inactiveSelectionBackground,#3a3d41))] ${width}`}
            />
          )}
        </For>
      </div>
    </div>
  );
}
