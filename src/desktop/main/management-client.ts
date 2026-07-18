import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  NdjsonRpcConnection,
  type AcpLaunchSpec,
} from "../acp-client/index.js";

/**
 * Client for the versioned management RPC (`hooman management`, plan §5.4):
 * one long-lived global process — not per-project like ACP — because config,
 * MCP, and skills are shared/home-scoped, not tied to a working directory.
 *
 * Uses the same generic NDJSON transport as the colocated ACP client
 * but never receives incoming requests from the management server, so its
 * agent-request handler always rejects.
 */
export class ManagementClient {
  #child: ChildProcessWithoutNullStreams | null = null;
  #connection: NdjsonRpcConnection | null = null;
  #starting: Promise<void> | null = null;

  constructor(private readonly launchSpec: AcpLaunchSpec) {}

  start(): Promise<void> {
    if (this.#starting) return this.#starting;
    this.#starting = this.#start();
    return this.#starting;
  }

  async #start(): Promise<void> {
    const child = spawn(this.launchSpec.command, this.launchSpec.args, {
      cwd: this.launchSpec.cwd,
      env: this.launchSpec.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) =>
      process.stderr.write(`[management] ${chunk}`),
    );
    child.on("exit", () => {
      this.#connection?.dispose();
      this.#connection = null;
      this.#child = null;
      this.#starting = null;
    });

    const exited = new Promise<never>((_resolve, reject) => {
      child.once("exit", (code, signal) =>
        reject(
          new Error(
            `management process exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          ),
        ),
      );
      child.once("error", reject);
    });

    this.#connection = new NdjsonRpcConnection(
      child.stdout,
      child.stdin,
      async () => {
        throw new Error("management server does not send client requests");
      },
    );

    await Promise.race([this.#connection.request("initialize"), exited]);
  }

  async #call<T>(method: string, params?: unknown): Promise<T> {
    await this.start();
    if (!this.#connection) throw new Error("management process not ready");
    return this.#connection.request<T>(method, params);
  }

  setupStatus(): Promise<{ configured: boolean }> {
    return this.#call("setup/status");
  }

  /** Real on-disk paths (`config.json`/`mcp.json`/skills dir) for main-process "open in native editor" actions. */
  getPaths(): Promise<{ config: string; mcp: string; skills: string }> {
    return this.#call("paths/get");
  }

  getConfig(): Promise<unknown> {
    return this.#call("config/get");
  }

  upsertProvider(params: {
    name: string;
    provider: string;
    options?: Record<string, unknown>;
  }): Promise<{ ok: true }> {
    return this.#call("config/upsertProvider", params);
  }

  deleteProvider(name: string): Promise<{ ok: true }> {
    return this.#call("config/deleteProvider", { name });
  }

  upsertLlm(params: {
    name: string;
    provider: string;
    options: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
    default?: boolean;
  }): Promise<{ ok: true }> {
    return this.#call("config/upsertLlm", params);
  }

  deleteLlm(name: string): Promise<{ ok: true }> {
    return this.#call("config/deleteLlm", { name });
  }

  saveGeneral(params: {
    name?: string;
    reasoning?: "collapsed" | "full";
    compaction?: { ratio?: number; keep?: number };
  }): Promise<{ ok: true }> {
    return this.#call("config/saveGeneral", params);
  }

  setPromptToggle(key: string, value: boolean): Promise<{ ok: true }> {
    return this.#call("config/setPromptToggle", { key, value });
  }

  setToolToggle(key: string, value: boolean): Promise<{ ok: true }> {
    return this.#call("config/setToolToggle", { key, value });
  }

  saveSearch(params: {
    enabled?: boolean;
    provider?: string;
    apiKey?: string;
    baseURL?: string;
    tool?: string;
  }): Promise<{ ok: true }> {
    return this.#call("config/saveSearch", params);
  }

  listMcpServers(): Promise<unknown> {
    return this.#call("mcp/list");
  }

  upsertMcpServer(name: string, transport: unknown): Promise<{ ok: true }> {
    return this.#call("mcp/upsert", { name, transport });
  }

  deleteMcpServer(name: string): Promise<{ ok: true }> {
    return this.#call("mcp/delete", { name });
  }

  listSkills(): Promise<
    Array<{ name: string; description?: string; folder: string }>
  > {
    return this.#call("skills/list");
  }

  searchSkills(
    query: string,
  ): Promise<
    Array<{ name: string; slug: string; source: string; installs: number }>
  > {
    return this.#call("skills/search", { query });
  }

  installSkill(source: string): Promise<{ ok: true }> {
    return this.#call("skills/install", { source });
  }

  deleteSkill(folder: string): Promise<{ ok: true }> {
    return this.#call("skills/delete", { folder });
  }

  stop(): void {
    this.#child?.kill();
  }
}
