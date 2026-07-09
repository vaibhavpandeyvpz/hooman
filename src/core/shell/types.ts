export type ShellJobStatus =
  "starting" | "running" | "ready" | "completed" | "stopped" | "failed";

export type NotifyOnOutput = {
  /** JavaScript regex matched against accumulated output. */
  pattern: string;
  /** Milliseconds that must elapse between match checks. */
  debounce_ms?: number;
};

export type ReadyProbe = {
  /** Regex matched against accumulated output to mark the job ready. */
  pattern?: string;
  /** Local TCP port to probe until it accepts connections. */
  port?: number;
  /** Milliseconds to wait for readiness before returning as still running. */
  timeout_ms?: number;
};

export type ShellJobStartOptions = {
  command: string;
  args: string[];
  cwd: string;
  description: string;
  /** Soft timeout for the whole job (ms). Undefined = no auto-kill. */
  timeoutMs?: number;
  outputByteLimit?: number;
  toolUseId?: string;
  notifyOnOutput?: NotifyOnOutput;
  ready?: ReadyProbe;
  /**
   * Max ms to wait before returning a background handle.
   * `0` = return immediately. Undefined with no notify/ready = wait for exit
   * (foreground). With notify/ready, wait until match or this deadline.
   */
  blockUntilMs?: number;
  cancelSignal?: AbortSignal;
};

export type ShellJobInfo = {
  id: string;
  description: string;
  command: string;
  cwd: string;
  status: ShellJobStatus;
  ready: boolean;
  pid?: number;
  terminalId?: string;
  toolUseId?: string;
  exitCode: number | null;
  signal: string | null;
  startedAt: number;
  endedAt?: number;
  outputTruncated: boolean;
};

export type ShellJobOutputSnapshot = {
  jobId: string;
  output: string;
  truncated: boolean;
  status: ShellJobStatus;
  ready: boolean;
  exitCode: number | null;
  signal: string | null;
  matched?: boolean;
};

export type ShellJobWaitOptions = {
  /** Wait for process exit (default true when no pattern). */
  block?: boolean;
  timeoutMs?: number;
  /** Wait for a NEW regex match since the last read offset. */
  pattern?: string;
  tailLines?: number;
  cancelSignal?: AbortSignal;
};

export type ShellJobEvent =
  | { type: "started"; job: ShellJobInfo }
  | { type: "output"; job: ShellJobInfo; chunk: string }
  | { type: "ready"; job: ShellJobInfo }
  | { type: "completed"; job: ShellJobInfo }
  | { type: "stopped"; job: ShellJobInfo }
  | { type: "failed"; job: ShellJobInfo; error: string };

export type ShellJobListener = (event: ShellJobEvent) => void;

/** Host-side terminal handle returned by TerminalBackend.spawn. */
export type HostTerminalHandle = {
  terminalId: string;
};
