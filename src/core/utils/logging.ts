import { format } from "node:util";
import pino from "pino";
import { configureLogging } from "@strands-agents/sdk";

/**
 * Where to send a console method's output: `stderr` rewrites it onto the
 * error stream, `silent` drops it entirely.
 */
type ConsoleRoute = "stderr" | "silent";

type ConsoleMethod = "log" | "info" | "debug" | "warn" | "error";

function redirectLogLevels(
  routes: Partial<Record<ConsoleMethod, ConsoleRoute>>,
): void {
  for (const [method, route] of Object.entries(routes) as Array<
    [ConsoleMethod, ConsoleRoute]
  >) {
    if (route === "silent") {
      console[method] = () => {};
    } else {
      console[method] = (...args: unknown[]) => {
        process.stderr.write(`${format(...args)}\n`);
      };
    }
  }
}

/**
 * Route every global `console` method to stderr for the process lifetime.
 * For surfaces whose stdout carries payload: `exec` (agent output), `daemon`
 * (nothing intentional on stdout), and especially `acp`, where stdout *is*
 * the JSON-RPC channel and a single stray `console.log` from a dependency
 * (e.g. `@huggingface/hub`'s `console.debug` "Downloading …" line) would
 * corrupt the protocol stream. Not for `chat`: raw stderr writes garble the
 * live Ink frame — use {@link quietChatLogs} there. Utility commands
 * (`sessions`, `config`, `mcp`) keep their intentional stdout output.
 */
export function redirectLogs(): void {
  redirectLogLevels({
    log: "stderr",
    info: "stderr",
    debug: "stderr",
    warn: "stderr",
    error: "stderr",
  });
}

/**
 * Quiet logging for the Ink `chat` surface. Drops `console.debug`/`console.info`
 * library chatter entirely — Ink's console patch would paint it into the
 * transcript, and raw stderr writes would garble the frame instead.
 * `console.log`/`warn`/`error` stay intact (the post-exit resume hint uses
 * `log`, and Ink surfaces real warnings cleanly). The Strands SDK logger is
 * silenced too, overriding {@link patchSdkLogger}: pino writes straight to
 * the stderr fd, bypassing Ink's patch — failures that matter reach the
 * transcript as thrown errors.
 */
export function quietChatLogs(): void {
  redirectLogLevels({ debug: "silent", info: "silent" });
  configureLogging({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  });
}

/**
 * Global default for the Strands SDK logger: pino on stderr, warnings and
 * errors only (the SDK's debug/info stream is developer tracing — at `debug`
 * it floods stderr on every turn). Applies to all commands; `chat` overrides
 * it via {@link quietChatLogs}.
 */
export function patchSdkLogger(): void {
  const logger = pino({ level: "warn" }, process.stderr);
  configureLogging(logger);
}
