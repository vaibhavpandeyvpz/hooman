import { spawn } from "node:child_process";
import { platform } from "node:os";

export async function openBrowser(url: string): Promise<void> {
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
