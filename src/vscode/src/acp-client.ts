import * as cp from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as vscode from "vscode";
import {
  client as buildClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ClientContext,
  type InitializeResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { FsBackend } from "./fs-backend";
import { TerminalBackend } from "./terminal-backend";
import { PermissionPrompts } from "./permissions";
import { resolveHoomanLaunch } from "./cli-launch";
import type {
  ModelDownloadNotification,
  ModelRetryNotification,
} from "./shared/protocol";

/** `../package.json` relative to the compiled `out/acp-client.js`, i.e. this sub-package's manifest. */
const EXTENSION_VERSION = (require("../package.json") as { version: string })
  .version;

/** Prefer Simple Browser; fall back to the system browser. Live reload is SSE. */
async function openDesignPreview(
  url: string,
): Promise<{ url: string; via: string }> {
  try {
    await vscode.commands.executeCommand("simpleBrowser.show", url);
    return { url, via: "simpleBrowser" };
  } catch {
    try {
      await vscode.commands.executeCommand("simpleBrowser.api.open", url);
      return { url, via: "simpleBrowser.api" };
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return { url, via: "openExternal" };
    }
  }
}

/**
 * Owns the `hooman acp` child process and the ACP client-role connection to
 * it. There is a single agent process for the whole extension lifetime;
 * every VS Code chat session maps to one ACP session multiplexed over it.
 */
export class HoomanAcpClient implements vscode.Disposable {
  #process: cp.ChildProcessWithoutNullStreams | null = null;
  #connection: ClientConnection | null = null;
  #starting: Promise<ClientContext> | null = null;
  #agentInfo: InitializeResponse | null = null;

  readonly #onSessionUpdate = new vscode.EventEmitter<SessionNotification>();
  readonly onSessionUpdate = this.#onSessionUpdate.event;

  /** Custom `_hoomanjs/model_download` notifications (model weights download progress). */
  readonly #onModelDownload =
    new vscode.EventEmitter<ModelDownloadNotification>();
  readonly onModelDownload = this.#onModelDownload.event;

  /** Custom `_hoomanjs/model_retry` notifications (live retry countdown). */
  readonly #onModelRetry = new vscode.EventEmitter<ModelRetryNotification>();
  readonly onModelRetry = this.#onModelRetry.event;

  readonly #onDidExit = new vscode.EventEmitter<void>();
  readonly onDidExit = this.#onDidExit.event;

  readonly fs = new FsBackend();
  readonly terminal: TerminalBackend;

  constructor(
    private readonly outputChannel: vscode.LogOutputChannel,
    private readonly permissions: PermissionPrompts,
  ) {
    this.terminal = new TerminalBackend(outputChannel);
  }

  get agentCapabilities(): InitializeResponse["agentCapabilities"] | undefined {
    return this.#agentInfo?.agentCapabilities;
  }

  /** Ensures the agent process + connection are up and returns the agent-side context to call `session/*` methods on. */
  async ensureStarted(): Promise<ClientContext> {
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
    const { command, args, env, shell } = await resolveHoomanLaunch(
      ["acp"],
      this.outputChannel,
    );
    this.outputChannel.info(
      `Starting Hooman ACP agent: ${command} ${args.join(" ")}`,
    );
    const child = cp.spawn(command, args, {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell,
    });
    this.#process = child;
    let startupStderr = "";
    let startupSettled = false;
    const startupFailure = new Promise<never>((_resolve, reject) => {
      child.once("error", (error) => {
        const message = `Hooman ACP agent failed to start: ${error.message}`;
        this.outputChannel.error(message);
        if (!startupSettled) {
          reject(new Error(message, { cause: error }));
        }
      });
      child.once("exit", (code, signal) => {
        if (!startupSettled) {
          const detail = startupStderr.trim();
          reject(
            new Error(
              `Hooman ACP agent exited before initialization (code=${code ?? "null"}, signal=${signal ?? "null"})${detail ? `: ${detail}` : ". Check the Hooman output for details."}`,
            ),
          );
        }
      });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      startupStderr = `${startupStderr}${chunk.toString("utf8")}`.slice(-8_192);
      this.outputChannel.debug(
        `[hooman acp] ${chunk.toString("utf8").trimEnd()}`,
      );
    });
    child.on("exit", (code, signal) => {
      this.outputChannel.info(
        `Hooman ACP agent exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      );
      this.#process = null;
      this.#connection = null;
      this.#starting = null;
      this.#onDidExit.fire();
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );

    const clientApp = buildClientApp({ name: "hoomanjs-vscode" })
      .onRequest(methods.client.session.requestPermission, (ctx) =>
        this.permissions.requestPermission(
          ctx.params.sessionId,
          ctx.params,
          cancellationTokenFromSignal(ctx.signal),
        ),
      )
      .onRequest(methods.client.fs.readTextFile, (ctx) =>
        this.fs.readTextFile(ctx.params),
      )
      .onRequest(methods.client.fs.writeTextFile, (ctx) =>
        this.fs.writeTextFile(ctx.params),
      )
      .onRequest(methods.client.terminal.create, (ctx) =>
        this.terminal.create(ctx.params),
      )
      .onRequest(methods.client.terminal.output, (ctx) =>
        this.terminal.output(ctx.params),
      )
      .onRequest(methods.client.terminal.release, async (ctx) => {
        await this.terminal.release(ctx.params);
      })
      .onRequest(methods.client.terminal.waitForExit, (ctx) =>
        this.terminal.waitForExit(ctx.params),
      )
      .onRequest(methods.client.terminal.kill, async (ctx) => {
        await this.terminal.kill(ctx.params);
      })
      .onRequest(
        "_hoomanjs/browser/open",
        (params) => params as { sessionId: string; url: string },
        async (ctx) => openDesignPreview(ctx.params.url),
      )
      .onNotification(methods.client.session.update, (ctx) => {
        this.#onSessionUpdate.fire(ctx.params);
      })
      .onNotification(
        "_hoomanjs/model_download",
        (params) => params as ModelDownloadNotification,
        (ctx) => {
          this.#onModelDownload.fire(ctx.params);
        },
      )
      .onNotification(
        "_hoomanjs/model_retry",
        (params) => params as ModelRetryNotification,
        (ctx) => {
          this.#onModelRetry.fire(ctx.params);
        },
      );

    this.#connection = clientApp.connect(stream);
    const agent = this.#connection.agent;

    try {
      this.#agentInfo = await Promise.race([
        agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
          clientInfo: { name: "hoomanjs-vscode", version: EXTENSION_VERSION },
        }),
        startupFailure,
      ]);
      startupSettled = true;
    } catch (error) {
      startupSettled = true;
      if (!child.killed) {
        child.kill();
      }
      throw error;
    }
    this.outputChannel.info(
      `Hooman ACP agent ready: ${this.#agentInfo.agentInfo?.name ?? "hooman"} ${this.#agentInfo.agentInfo?.version ?? ""}`,
    );
    return agent;
  }

  dispose(): void {
    this.terminal.dispose();
    this.#onSessionUpdate.dispose();
    this.#onModelDownload.dispose();
    this.#onModelRetry.dispose();
    this.#onDidExit.dispose();
    if (this.#process && !this.#process.killed) {
      this.#process.kill();
    }
    this.#process = null;
    this.#connection = null;
    this.#starting = null;
  }
}

/** Bridges a `signal`-based cancellation to a `vscode.CancellationToken`. */
function cancellationTokenFromSignal(
  signal: AbortSignal,
): vscode.CancellationToken {
  const source = new vscode.CancellationTokenSource();
  if (signal.aborted) {
    source.cancel();
  } else {
    signal.addEventListener("abort", () => source.cancel(), { once: true });
  }
  return source.token;
}
