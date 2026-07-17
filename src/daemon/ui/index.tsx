import { render } from "ink";
import type { DaemonDashboardStore } from "../dashboard/store.js";
import { DaemonDashboardApp } from "./DaemonDashboardApp.js";

export type DaemonDashboardHandle = {
  stop: () => void;
};

/**
 * Renders the daemon dashboard into the normal terminal buffer. `onQuit`
 * fires on `q` or Ctrl+C so the caller can trigger the same graceful
 * shutdown path as SIGINT/SIGTERM; call `stop()` once daemon shutdown
 * completes to unmount cleanly.
 */
export function launchDaemonDashboard(
  store: DaemonDashboardStore,
  onQuit: () => void,
): DaemonDashboardHandle {
  const { unmount } = render(
    <DaemonDashboardApp store={store} onQuit={onQuit} />,
    { exitOnCtrlC: false },
  );
  return { stop: unmount };
}
