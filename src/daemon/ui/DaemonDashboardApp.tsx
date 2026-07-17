import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { theme } from "../../core/theme.js";
import type { DaemonDashboardStore } from "../dashboard/store.js";
import type { DaemonDashboardSnapshot } from "../dashboard/types.js";
import { Footer } from "./Footer.js";
import { Header } from "./Header.js";
import { Lane } from "./Lane.js";

const WIDE_COLUMNS = 110;
const LANES = ["idle", "in_progress", "disposed"] as const;
type LaneKey = (typeof LANES)[number];

const LANE_TITLES: Record<LaneKey, string> = {
  idle: "Idle",
  in_progress: "In progress",
  disposed: "Disposed",
};

const LANE_ACCENTS: Record<LaneKey, string> = {
  idle: theme.secondary,
  in_progress: theme.primary,
  disposed: theme.muted,
};

function laneCards(snapshot: DaemonDashboardSnapshot, lane: LaneKey) {
  if (lane === "idle") {
    return snapshot.idle;
  }
  if (lane === "in_progress") {
    return snapshot.inProgress;
  }
  return snapshot.disposed;
}

export type DaemonDashboardAppProps = {
  store: DaemonDashboardStore;
  onQuit: () => void;
};

export function DaemonDashboardApp({ store, onQuit }: DaemonDashboardAppProps) {
  const [snapshot, setSnapshot] = useState<DaemonDashboardSnapshot>(() =>
    store.snapshot(),
  );
  const [focusedLane, setFocusedLane] = useState(1);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setSnapshot(store.snapshot()));
    const timer = setInterval(() => setSnapshot(store.snapshot()), 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [store]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      onQuit();
      return;
    }
    if (input === "l") {
      setShowDiagnostics((prev) => !prev);
      return;
    }
    if (key.leftArrow) {
      setFocusedLane((prev) => (prev + LANES.length - 1) % LANES.length);
    } else if (key.rightArrow) {
      setFocusedLane((prev) => (prev + 1) % LANES.length);
    }
  });

  const wide = columns >= WIDE_COLUMNS;
  const diagnosticRows = showDiagnostics
    ? Math.min(8, snapshot.diagnostics.length + 1)
    : 0;
  const headerFooterRows = 7;
  const availableRows = Math.max(4, rows - headerFooterRows - diagnosticRows);
  const maxVisiblePerLane = Math.max(1, Math.floor(availableRows / 4));

  return (
    <Box flexDirection="column" width={columns}>
      <Header snapshot={snapshot} />
      {wide ? (
        <Box flexDirection="row" gap={1}>
          {LANES.map((lane) => (
            <Lane
              key={lane}
              title={LANE_TITLES[lane]}
              accent={LANE_ACCENTS[lane]}
              cards={laneCards(snapshot, lane)}
              now={snapshot.now}
              width={Math.floor(columns / 3) - 1}
              maxVisible={maxVisiblePerLane}
              selectedKey={undefined}
            />
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.muted}>
            {LANES.map((lane, index) => {
              const active = index === focusedLane;
              const label = `${LANE_TITLES[lane]} (${laneCards(snapshot, lane).length})`;
              return active ? `[${label}]  ` : `${label}  `;
            }).join("")}
          </Text>
          <Lane
            title={LANE_TITLES[LANES[focusedLane]!]}
            accent={LANE_ACCENTS[LANES[focusedLane]!]}
            cards={laneCards(snapshot, LANES[focusedLane]!)}
            now={snapshot.now}
            width={columns - 1}
            maxVisible={maxVisiblePerLane * 2}
            selectedKey={undefined}
          />
        </Box>
      )}
      {showDiagnostics ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.muted}
          paddingX={1}
        >
          <Text bold color={theme.muted}>
            Diagnostics
          </Text>
          {snapshot.diagnostics
            .slice(-diagnosticRows + 1)
            .map((line, index) => (
              <Text key={index} color={theme.muted} wrap="truncate-end">
                {line}
              </Text>
            ))}
        </Box>
      ) : null}
      <Footer showingDiagnostics={showDiagnostics} />
    </Box>
  );
}
