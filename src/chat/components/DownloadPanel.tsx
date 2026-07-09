import { Box, Text } from "ink";
import { theme } from "../../core/theme.js";
import {
  downloadRatio,
  formatBytes,
  formatBytesPerSecond,
  formatEtaSeconds,
  renderDownloadBar,
  type ModelDownloadProgress,
} from "../../core/utils/download-progress.js";

/**
 * Transient chrome row shown while model weights are being downloaded (e.g.
 * a llama.cpp GGUF fetched from the Hugging Face Hub on first use): progress
 * bar, percent, transferred vs total size, speed, and ETA.
 */
export function DownloadPanel({
  progress,
}: {
  progress: ModelDownloadProgress;
}) {
  const ratio = downloadRatio(progress);
  const size =
    progress.totalBytes !== undefined
      ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`
      : formatBytes(progress.receivedBytes);
  return (
    <Box marginTop={1}>
      <Text wrap="truncate-end">
        <Text color={theme.muted}>downloading </Text>
        <Text bold>{progress.file}</Text>
        {progress.shard ? (
          <Text color={theme.muted}>
            {` (shard ${progress.shard.index}/${progress.shard.total})`}
          </Text>
        ) : null}
        {ratio !== undefined ? (
          <>
            <Text color={theme.primary}> {renderDownloadBar(ratio)}</Text>
            <Text> {Math.floor(ratio * 100)}%</Text>
          </>
        ) : null}
        <Text color={theme.muted}> • {size}</Text>
        {progress.bytesPerSecond !== undefined ? (
          <Text color={theme.muted}>
            {" • "}
            {formatBytesPerSecond(progress.bytesPerSecond)}
          </Text>
        ) : null}
        {progress.etaSeconds !== undefined ? (
          <Text color={theme.muted}>
            {" "}
            • eta {formatEtaSeconds(progress.etaSeconds)}
          </Text>
        ) : null}
      </Text>
    </Box>
  );
}
