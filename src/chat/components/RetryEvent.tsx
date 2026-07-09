import { Box, Text } from "ink";
import type { ChatLine } from "../types.js";
import { ReasoningStrip } from "./ReasoningStrip.js";
import { theme } from "../../core/theme.js";

export function RetryEvent({ line }: { line: ChatLine }) {
  const retryIn = Math.max(0, line.retryInSeconds ?? 0);
  const attempt = line.attempt ?? 1;
  const maxAttempts = line.maxAttempts ?? 1;
  const detail = line.errorDetail?.trim() || line.content.trim();

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" width="100%">
        <Text bold color={theme.warning}>
          Request failed
        </Text>
        <Text color={theme.muted}>
          {` · retrying in ${retryIn}s · attempt ${attempt}/${maxAttempts}`}
        </Text>
      </Box>
      {detail ? <ReasoningStrip text={detail} maxVisibleLines={2} /> : null}
    </Box>
  );
}
