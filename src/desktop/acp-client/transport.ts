import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import readline from "node:readline";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};
type JsonRpcNotification = { jsonrpc: "2.0"; method: string; params?: unknown };
type IncomingMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
};

export type AgentRequestHandler = (
  method: string,
  params: unknown,
) => Promise<unknown>;

export type NdjsonRpcEvents = {
  notification: [method: string, params: unknown];
  requestError: [error: Error];
};

/**
 * Minimal newline-delimited JSON-RPC 2.0 transport over a pair of Node
 * streams. Matches the ACP wire format (`ndJsonStream` in
 * `@agentclientprotocol/sdk`) without depending on the SDK, so this package
 * has no runtime dependency on VS Code, Electron, or the SDK's own client
 * scaffolding.
 */
export class NdjsonRpcConnection extends EventEmitter {
  #nextId = 1;
  #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #writable: Writable;
  #agentRequestHandler: AgentRequestHandler;

  constructor(
    readable: Readable,
    writable: Writable,
    agentRequestHandler: AgentRequestHandler,
  ) {
    super();
    this.#writable = writable;
    this.#agentRequestHandler = agentRequestHandler;
    const rl = readline.createInterface({ input: readable });
    rl.on("line", (line) => this.#handleLine(line));
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: IncomingMessage;
    try {
      message = JSON.parse(trimmed) as IncomingMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      void this.#respondToAgentRequest(
        message.id,
        message.method,
        message.params,
      );
      return;
    }
    if (message.method !== undefined) {
      this.emit("notification", message.method, message.params);
    }
  }

  async #respondToAgentRequest(
    id: number,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const result = await this.#agentRequestHandler(method, params);
      this.#write({ jsonrpc: "2.0", id, result } as JsonRpcResponse);
    } catch (error) {
      this.#write({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      } as JsonRpcResponse);
      this.emit(
        "requestError",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.#write({ jsonrpc: "2.0", id, method, params } as JsonRpcRequest);
    });
  }

  notify(method: string, params?: unknown): void {
    this.#write({ jsonrpc: "2.0", method, params } as JsonRpcNotification);
  }

  #write(
    message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification,
  ): void {
    this.#writable.write(`${JSON.stringify(message)}\n`);
  }

  dispose(): void {
    for (const { reject } of this.#pending.values()) {
      reject(new Error("Connection closed"));
    }
    this.#pending.clear();
  }
}
