import { Box, Text } from "ink";
import { theme } from "../../core/theme.js";
import {
  formatCostUsd,
  formatTokenCount,
} from "../../core/utils/usage-format.js";
import type { DaemonDashboardSnapshot } from "../dashboard/types.js";
import { formatElapsed } from "./format.js";

function childStateColor(
  state: DaemonDashboardSnapshot["acpChildState"],
): string {
  switch (state) {
    case "connected":
      return theme.success;
    case "reconnecting":
      return theme.warning;
    case "stopped":
      return theme.error;
    default:
      return theme.muted;
  }
}

export function Header({ snapshot }: { snapshot: DaemonDashboardSnapshot }) {
  const { aggregateUsage } = snapshot;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold color={theme.primary}>
          Hooman daemon
        </Text>
        <Text
          color={theme.muted}
        >{` ${snapshot.draining ? "draining" : "running"} \u00b7 uptime ${formatElapsed(snapshot.startedAt, snapshot.now)}`}</Text>
      </Text>
      <Text color={theme.muted}>
        {`channels ${snapshot.channels.length || 0}`}
        {" \u00b7 "}
        <Text color={childStateColor(snapshot.acpChildState)}>
          acp {snapshot.acpChildState}
        </Text>
        {` \u00b7 sessions ${snapshot.poolActive}/${snapshot.poolMax}`}
        {snapshot.poolWaiting > 0 ? ` (+${snapshot.poolWaiting} waiting)` : ""}
        {` \u00b7 queued ${snapshot.totalQueued}`}
        {` \u00b7 mcp ${snapshot.mcpServerCount}`}
      </Text>
      <Text color={theme.muted}>
        {`tokens ${formatTokenCount(aggregateUsage.inputTokens)} in / ${formatTokenCount(aggregateUsage.outputTokens)} out`}
        {` \u00b7 cost ${formatCostUsd(aggregateUsage.costUsd)}${aggregateUsage.costComplete ? "" : "+"}`}
      </Text>
    </Box>
  );
}
