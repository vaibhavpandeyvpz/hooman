import { Box, Text } from "ink";
import type { ShellJobInfo } from "../../core/shell/index.js";
import { theme } from "../../core/theme.js";

type BackgroundJobsPanelProps = {
  jobs: readonly ShellJobInfo[];
};

/**
 * Compact strip above the composer listing active background shell jobs.
 * Use `/tasks` to pick a job and stop it.
 */
export function BackgroundJobsPanel({ jobs }: BackgroundJobsPanelProps) {
  if (jobs.length === 0) {
    return null;
  }

  const countLabel =
    jobs.length === 1 ? "1 background job" : `${jobs.length} background jobs`;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text color={theme.secondary}>▸ {countLabel} · /tasks to stop</Text>
    </Box>
  );
}
