import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { ChatLine } from "../types.js";
import { formatToolArgs } from "./shared.js";
import { Spinner } from "./Spinner.js";
import { theme } from "../../core/theme.js";
import { peekShellJobManager } from "../../core/shell/index.js";

const LIVE_TAIL_CHARS = 4_000;

type ShellToolEventProps = {
  line: ChatLine;
  agent?: object;
};

function extractJobId(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { job_id?: string };
    if (typeof parsed.job_id === "string" && parsed.job_id.length > 0) {
      return parsed.job_id;
    }
  } catch {
    // not JSON
  }
  return undefined;
}

function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `…\n${text.slice(-maxChars)}`;
}

/**
 * Live shell tool card: shows a monospace scrollback while a foreground shell
 * is running, or while a background job (from the result's job_id) is still
 * active.
 */
export function ShellToolEvent({ line, agent }: ShellToolEventProps) {
  const args = formatToolArgs(line.content)[0] ?? "";
  const jobId =
    line.shellJobId ??
    extractJobId(line.resultContent) ??
    extractJobId(line.content);
  const [liveOutput, setLiveOutput] = useState(line.liveOutput ?? "");
  const [jobActive, setJobActive] = useState(Boolean(jobId));

  useEffect(() => {
    if (!agent || !jobId) {
      return;
    }
    const manager = peekShellJobManager(agent);
    if (!manager) {
      return;
    }

    let active = true;
    const refresh = () => {
      if (!active) {
        return;
      }
      const info = manager.get(jobId);
      if (!info) {
        setJobActive(false);
        return;
      }
      const stillActive =
        info.status === "starting" ||
        info.status === "running" ||
        info.status === "ready";
      setJobActive(stillActive);
      void manager.output(jobId, { block: false }).then((snap) => {
        if (active) {
          setLiveOutput(truncateTail(snap.output, LIVE_TAIL_CHARS));
        }
      });
    };

    refresh();
    const timer = setInterval(refresh, 400);
    const unsub = manager.on((event) => {
      if (event.job.id === jobId) {
        refresh();
      }
    });
    return () => {
      active = false;
      clearInterval(timer);
      unsub();
    };
  }, [agent, jobId]);

  const showLive =
    (line.phase === "running" && Boolean(line.liveOutput || liveOutput)) ||
    (Boolean(jobId) && jobActive && liveOutput.length > 0);

  const displayOutput = liveOutput
    ? liveOutput
    : line.liveOutput
      ? truncateTail(line.liveOutput, LIVE_TAIL_CHARS)
      : null;

  return (
    <Box flexDirection="column" width="100%">
      <Text color={theme.warning} bold>
        Tool
      </Text>
      <Text>
        <Text bold>{line.toolName ?? "shell"}</Text>
        <Text>{args ? `: ${args}` : ""}</Text>
      </Text>
      {line.phase === "running" ? (
        <Box flexDirection="row">
          <Spinner type="dots" color={theme.warning} />
          <Text color={theme.muted}> running...</Text>
        </Box>
      ) : null}
      {jobId ? (
        <Text color={theme.secondary}>
          {jobActive ? "background" : "stopped"} · {jobId}
        </Text>
      ) : null}
      {showLive && displayOutput ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.muted}
          paddingX={1}
        >
          <Text color={theme.muted}>{displayOutput}</Text>
        </Box>
      ) : null}
      {line.phase === "done" && line.resultContent && !jobId ? (
        <Text color={theme.muted}>
          {line.resultContent.length > 256
            ? `${line.resultContent.slice(0, 256)}…`
            : line.resultContent}
        </Text>
      ) : null}
      {line.phase === "done" && jobId && !jobActive && liveOutput ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.muted}
          paddingX={1}
        >
          <Text color={theme.muted}>
            {truncateTail(liveOutput, LIVE_TAIL_CHARS)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
