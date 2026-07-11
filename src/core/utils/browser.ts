import { spawn } from "node:child_process";
import { platform } from "node:os";

export async function openExternalBrowser(url: string): Promise<void> {
  const target = url.trim();
  if (!target) {
    throw new Error("Browser URL is required.");
  }

  const command =
    platform() === "darwin"
      ? { bin: "open", args: [target] }
      : platform() === "win32"
        ? { bin: "cmd", args: ["/c", "start", "", target] }
        : { bin: "xdg-open", args: [target] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.bin, command.args, {
      stdio: "ignore",
      detached: true,
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
