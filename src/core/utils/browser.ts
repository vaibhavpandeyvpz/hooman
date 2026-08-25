import { spawn } from "node:child_process";
import { platform } from "node:os";

export async function openExternalBrowser(url: string): Promise<void> {
  const target = url.trim();
  if (!target) {
    throw new Error("Browser URL is required.");
  }

  // On Windows, `cmd /c start` re-parses its command line itself: unquoted
  // `&`, `|`, `^`, etc. are cmd.exe metacharacters (e.g. command separators),
  // and OAuth/query-string URLs almost always contain `&`. Node's default
  // Windows argv escaping only quotes args that contain spaces, so a bare
  // URL like `...?a=1&b=2` reaches cmd.exe unquoted and gets silently split
  // at the first `&`, truncating the URL. Quoting both the `start` title arg
  // and the URL ourselves, combined with `windowsVerbatimArguments: true`
  // (which disables Node's own quoting so ours is passed through as-is),
  // keeps the whole URL intact.
  const command =
    platform() === "darwin"
      ? { bin: "open", args: [target], verbatim: false }
      : platform() === "win32"
        ? {
            bin: "cmd",
            args: ["/c", "start", '""', `"${target}"`],
            verbatim: true,
          }
        : { bin: "xdg-open", args: [target], verbatim: false };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.bin, command.args, {
      stdio: "ignore",
      detached: true,
      windowsVerbatimArguments: command.verbatim,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export type BrowserPreviewBackend = {
  open(url: string): Promise<void>;
};

/** Keyed by the Strands agent instance so backends are never serialized. */
const backends = new WeakMap<object, BrowserPreviewBackend>();

export function setBrowserPreviewBackend(
  agent: object,
  backend: BrowserPreviewBackend,
): void {
  backends.set(agent, backend);
}

export function getBrowserPreviewBackend(
  agent: object | undefined,
): BrowserPreviewBackend | undefined {
  return agent ? backends.get(agent) : undefined;
}

/** CLI / default backend: open via the OS browser. */
export function createOsBrowserPreviewBackend(): BrowserPreviewBackend {
  return {
    async open(url: string) {
      await openExternalBrowser(url);
    },
  };
}
