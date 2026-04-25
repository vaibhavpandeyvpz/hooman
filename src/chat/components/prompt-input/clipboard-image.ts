import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { attachmentsPath } from "../../../core/utils/paths.ts";

const execFileAsync = promisify(execFile);

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function createClipboardImagePath(): Promise<string> {
  const root = attachmentsPath();
  await mkdir(root, { recursive: true });
  return join(root, `${randomUUID()}-clipboard.png`);
}

async function fileHasContent(path: string): Promise<boolean> {
  try {
    const data = await readFile(path);
    return data.length > 0;
  } catch {
    return false;
  }
}

async function saveMacClipboardImage(): Promise<string | null> {
  const outputPath = await createClipboardImagePath();
  const outputPathLiteral = appleScriptString(outputPath);

  try {
    await execFileAsync("osascript", [
      "-e",
      "set png_data to (the clipboard as «class PNGf»)",
      "-e",
      `set fp to open for access POSIX file ${outputPathLiteral} with write permission`,
      "-e",
      "set eof fp to 0",
      "-e",
      "write png_data to fp",
      "-e",
      "close access fp",
    ]);
    return (await fileHasContent(outputPath)) ? outputPath : null;
  } catch {
    await unlink(outputPath).catch(() => undefined);
    return null;
  }
}

async function saveLinuxClipboardImage(): Promise<string | null> {
  const outputPath = await createClipboardImagePath();
  const candidates: Array<[string, string[]]> = [
    ["wl-paste", ["--type", "image/png"]],
    ["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "image/jpeg", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "image/webp", "-o"]],
    ["xsel", ["--clipboard", "--output"]],
  ];

  for (const [command, args] of candidates) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        encoding: "buffer",
        maxBuffer: 20 * 1024 * 1024,
      });
      if (!Buffer.isBuffer(stdout) || stdout.length === 0) {
        continue;
      }
      await writeFile(outputPath, stdout);
      return outputPath;
    } catch {
      // Try the next clipboard utility.
    }
  }

  await unlink(outputPath).catch(() => undefined);
  return null;
}

async function saveWindowsClipboardImage(): Promise<string | null> {
  const outputPath = await createClipboardImagePath();
  const escapedPath = outputPath.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    "if ($null -eq $img) { exit 1 }",
    `$img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join("; ");

  try {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return (await fileHasContent(outputPath)) ? outputPath : null;
  } catch {
    await unlink(outputPath).catch(() => undefined);
    return null;
  }
}

export async function saveClipboardImageAsAttachment(): Promise<string | null> {
  switch (process.platform) {
    case "darwin":
      return saveMacClipboardImage();
    case "linux":
      return saveLinuxClipboardImage();
    case "win32":
      return saveWindowsClipboardImage();
    default:
      return null;
  }
}
