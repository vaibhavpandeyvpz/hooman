export type {
  HostTerminalHandle,
  NotifyOnOutput,
  ReadyProbe,
  ShellJobEvent,
  ShellJobInfo,
  ShellJobListener,
  ShellJobOutputSnapshot,
  ShellJobStartOptions,
  ShellJobStatus,
  ShellJobWaitOptions,
} from "./types.js";
export {
  OutputBuffer,
  RING_CAPACITY_BYTES,
  WATCHDOG_MAX_BYTES,
} from "./output-buffer.js";
export { ShellJobManager } from "./manager.js";
export {
  clearShellJobManager,
  getShellJobManager,
  peekShellJobManager,
} from "./registry.js";
export type {
  TerminalBackend,
  TerminalOutputSnapshot,
  TerminalRunRequest,
  TerminalRunResult,
  TerminalSpawnResult,
} from "./terminal-backend.js";
export { getTerminalBackend, setTerminalBackend } from "./terminal-backend.js";
export {
  createShellTools,
  SHELL_OUTPUT_TOOL_NAME,
  SHELL_STOP_TOOL_NAME,
  SHELL_TOOL_NAME,
} from "./tools.js";
