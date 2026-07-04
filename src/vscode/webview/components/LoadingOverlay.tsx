import { Show } from "solid-js";
import { Loader2 } from "lucide-solid";
import { state } from "../store";

/**
 * Full-pane blur overlay shown while switching sessions (`session/load` +
 * history replay stream in behind it).
 */
export default function LoadingOverlay() {
  return (
    <Show when={state.loadingSession}>
      <div class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2.5 bg-background/60 backdrop-blur-sm">
        <Loader2 size={26} class="animate-spin text-accent" />
        <div class="max-w-[80%] truncate px-4 text-[12.5px] text-muted">
          {state.loadingSession}
        </div>
      </div>
    </Show>
  );
}
