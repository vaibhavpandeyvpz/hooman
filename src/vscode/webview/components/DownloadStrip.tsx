import { Show } from "solid-js";
import { Download } from "lucide-solid";
import { formatBytes, formatEtaSeconds } from "../lib/format";
import { state } from "../store";

/**
 * Transient strip shown while model weights are being downloaded (llama.cpp
 * GGUF fetched from the Hugging Face Hub on first use): file name, progress
 * bar, percent, transferred vs total size, speed, and ETA. Fed by the agent's
 * custom `_hoomanjs/model_download` ACP notification; cleared when the
 * download finishes (or the turn ends).
 */
export default function DownloadStrip() {
  const ratio = () => {
    const download = state.download;
    return download?.totalBytes && download.totalBytes > 0
      ? Math.min(1, download.receivedBytes / download.totalBytes)
      : null;
  };
  return (
    <Show when={state.download}>
      {(download) => (
        <div class="mx-2.5 mb-1.5 rounded border border-border bg-panel px-2 py-1.5 text-[11px] text-muted">
          <div class="flex items-center gap-2">
            <Download size={11} class="shrink-0 text-accent" />
            <span class="truncate" title={download().model}>
              {download().file}
              <Show when={download().shard}>
                {(shard) => (
                  <span class="text-muted">
                    {" "}
                    (shard {shard().index}/{shard().total})
                  </span>
                )}
              </Show>
            </span>
            <span class="ml-auto shrink-0 font-mono tabular-nums">
              <Show when={ratio() !== null}>
                {Math.floor((ratio() ?? 0) * 100)}% ·{" "}
              </Show>
              {formatBytes(download().receivedBytes)}
              <Show when={download().totalBytes !== undefined}>
                {" / "}
                {formatBytes(download().totalBytes!)}
              </Show>
            </span>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <span class="h-[5px] flex-1 overflow-hidden rounded-full border border-border">
              <span
                class={`block h-full rounded-full bg-accent transition-[width] duration-300 ${
                  ratio() === null ? "w-full animate-pulse" : ""
                }`}
                style={
                  ratio() !== null
                    ? {
                        width: `${Math.max(2, Math.round((ratio() ?? 0) * 100))}%`,
                      }
                    : undefined
                }
              />
            </span>
            <span class="shrink-0 font-mono tabular-nums">
              <Show when={download().bytesPerSecond !== undefined}>
                {formatBytes(download().bytesPerSecond!)}/s
              </Show>
              <Show when={download().etaSeconds !== undefined}>
                {" · eta "}
                {formatEtaSeconds(download().etaSeconds!)}
              </Show>
            </span>
          </div>
        </div>
      )}
    </Show>
  );
}
