import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  client as buildClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ClientContext,
  type ContentBlock,
  type InitializeResponse,
  type McpServer,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionResponse,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import { HOOMAN_X_DAEMON_ENV } from "../acp/meta/daemon.js";

export type AcpPermissionHandler = (
  sessionId: string,
  request: RequestPermissionRequest,
  signal: AbortSignal,
) => Promise<RequestPermissionResponse>;

export type AcpSessionUpdateHandler = (
  notification: SessionNotification,
) => void;

export type AcpDaemonClientOptions = {
  /** Absolute path to the built `dist/cli.js`. */
  cliPath: string;
  /** Default cwd for daemon-hosted ACP sessions. */
  cwd: string;
  onPermissionRequest: AcpPermissionHandler;
  onSessionUpdate: AcpSessionUpdateHandler;
  /** Raw child stderr lines, for daemon diagnostics. */
  onChildStderr?: (line: string) => void;
};

/**
 * Owns the single `hooman acp` child process the daemon multiplexes every
 * ACP session over, and the ACP client-role connection to it. Lazily
 * (re)spawns on first use and after an unexpected exit, so a crashed child is
 * recovered on the next call rather than requiring a daemon restart.
 */
export class AcpDaemonClient {
  #child: ChildProcessWithoutNullStreams | null = null;
  #connection: ClientConnection | null = null;
  #starting: Promise<ClientContext> | null = null;
  #agentInfo: InitializeResponse | undefined;
  #closed = false;

  public constructor(private readonly options: AcpDaemonClientOptions) {}

  public get agentCapabilities():
    InitializeResponse["agentCapabilities"] | undefined {
    return this.#agentInfo?.agentCapabilities;
  }

  /** Ensures the child process + connection are up, spawning/reconnecting lazily if needed. */
  public async ensureStarted(): Promise<ClientContext> {
    if (this.#closed) {
      throw new Error("ACP daemon client is closed.");
    }
    if (this.#starting) {
      return this.#starting;
    }
    this.#starting = this.#start().catch((error) => {
      this.#starting = null;
      throw error;
    });
    return this.#starting;
  }

  async #start(): Promise<ClientContext> {
    const child = spawn(process.execPath, [this.options.cliPath, "acp"], {
      cwd: this.options.cwd,
      env: { ...process.env, [HOOMAN_X_DAEMON_ENV]: "true" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    let stderrBuffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer = `${stderrBuffer}${chunk.toString("utf8")}`;
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          this.options.onChildStderr?.(line);
        }
      }
    });
    child.on("exit", () => {
      this.#child = null;
      this.#connection = null;
      this.#starting = null;
      this.#agentInfo = undefined;
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );

    const clientApp = buildClientApp({ name: "hoomanjs-daemon" })
      .onRequest(methods.client.session.requestPermission, (ctx) =>
        this.options.onPermissionRequest(
          ctx.params.sessionId,
          ctx.params,
          ctx.signal,
        ),
      )
      .onNotification(methods.client.session.update, (ctx) => {
        this.options.onSessionUpdate(ctx.params);
      });

    this.#connection = clientApp.connect(stream);
    const agent = this.#connection.agent;
    this.#agentInfo = await agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    return agent;
  }

  public async newSession(params: {
    cwd: string;
    mcpServers: McpServer[];
    meta?: Record<string, unknown>;
  }): Promise<NewSessionResponse> {
    const agent = await this.ensureStarted();
    return agent.request(methods.agent.session.new, {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      ...(params.meta ? { _meta: params.meta } : {}),
    });
  }

  public async resumeSession(params: {
    sessionId: string;
    cwd: string;
    mcpServers: McpServer[];
    meta?: Record<string, unknown>;
  }): Promise<ResumeSessionResponse> {
    const agent = await this.ensureStarted();
    return agent.request(methods.agent.session.resume, {
      sessionId: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      ...(params.meta ? { _meta: params.meta } : {}),
    });
  }

  public async prompt(params: {
    sessionId: string;
    prompt: ContentBlock[];
    meta?: Record<string, unknown>;
  }): Promise<PromptResponse> {
    const agent = await this.ensureStarted();
    return agent.request(methods.agent.session.prompt, {
      sessionId: params.sessionId,
      prompt: params.prompt,
      ...(params.meta ? { _meta: params.meta } : {}),
    });
  }

  public async closeSession(sessionId: string): Promise<void> {
    const agent = await this.ensureStarted();
    await agent.request(methods.agent.session.close, { sessionId });
  }

  /** Fire-and-forget per the ACP spec; a no-op when the connection is already gone. */
  public cancelSession(sessionId: string): void {
    if (!this.#connection) {
      return;
    }
    void this.#connection.agent
      .notify(methods.agent.session.cancel, { sessionId })
      .catch(() => undefined);
  }

  public async setConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const agent = await this.ensureStarted();
    return agent.request(methods.agent.session.setConfigOption, params);
  }

  /** Stops accepting work and terminates the child; safe to call more than once. */
  public async close(): Promise<void> {
    this.#closed = true;
    this.#connection = null;
    this.#starting = null;
    const child = this.#child;
    this.#child = null;
    if (child && !child.killed) {
      child.kill();
    }
  }
}
