import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { lookupCommandPath } from "../utils/command-path.js";
import { binPath, ripgrepPath } from "../utils/paths.js";

const execFileAsync = promisify(execFile);

const RIPGREP_VERSION = "15.1.0";
const DOWNLOAD_TIMEOUT_MS = 600_000;

type ArchiveExtension = "tar.gz" | "zip";

type DownloadTarget = {
  target: string;
  extension: ArchiveExtension;
};

const DOWNLOAD_TARGETS: Record<string, DownloadTarget> = {
  "arm64-darwin": {
    target: "aarch64-apple-darwin",
    extension: "tar.gz",
  },
  "x64-darwin": {
    target: "x86_64-apple-darwin",
    extension: "tar.gz",
  },
  "arm64-linux": {
    target: "aarch64-unknown-linux-gnu",
    extension: "tar.gz",
  },
  "x64-linux": {
    target: "x86_64-unknown-linux-musl",
    extension: "tar.gz",
  },
  "arm64-win32": {
    target: "aarch64-pc-windows-msvc",
    extension: "zip",
  },
  "x64-win32": {
    target: "x86_64-pc-windows-msvc",
    extension: "zip",
  },
} as const;

const ARCHIVE_SHA256: Record<string, string> = {
  "ripgrep-15.1.0-aarch64-apple-darwin.tar.gz":
    "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
  "ripgrep-15.1.0-aarch64-pc-windows-msvc.zip":
    "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e",
  "ripgrep-15.1.0-aarch64-unknown-linux-gnu.tar.gz":
    "2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
  "ripgrep-15.1.0-x86_64-apple-darwin.tar.gz":
    "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
  "ripgrep-15.1.0-x86_64-pc-windows-msvc.zip":
    "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
  "ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz":
    "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
};

let resolvedRipgrepPath: Promise<string> | undefined;

async function isExistingFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function detectTargetConfig(): DownloadTarget {
  const key = `${process.arch}-${process.platform}`;
  const target = DOWNLOAD_TARGETS[key];
  if (!target) {
    throw new Error(
      `Unsupported platform for ripgrep bootstrap: ${process.platform}/${process.arch}`,
    );
  }
  return target;
}

function archiveName(config: DownloadTarget): string {
  return `ripgrep-${RIPGREP_VERSION}-${config.target}.${config.extension}`;
}

async function sha256File(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function downloadArchive(url: string, targetPath: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to download ripgrep (${response.status} ${url})`);
  }
  if (!response.body) {
    throw new Error("Ripgrep download response body was empty.");
  }

  await pipeline(
    Readable.fromWeb(response.body as ReadableStream),
    createWriteStream(targetPath),
  );
}

function selectPowerShell(): string {
  if (process.platform !== "win32") {
    return "powershell.exe";
  }
  return (
    lookupCommandPath("pwsh.exe") ||
    lookupCommandPath("powershell.exe") ||
    "powershell.exe"
  );
}

function escapeSingleQuotes(value: string): string {
  return value.split("'").join("''");
}

async function extractArchive(
  archivePath: string,
  destinationDir: string,
  extension: ArchiveExtension,
): Promise<void> {
  if (extension === "tar.gz") {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destinationDir], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return;
  }

  const escapedArchive = escapeSingleQuotes(archivePath);
  const escapedDestination = escapeSingleQuotes(destinationDir);
  const shell = selectPowerShell();
  await execFileAsync(
    shell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`,
    ],
    {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

async function installManagedRipgrep(): Promise<string> {
  const config = detectTargetConfig();
  const fileName = archiveName(config);
  const expectedHash = ARCHIVE_SHA256[fileName];
  if (!expectedHash) {
    throw new Error(`Missing pinned SHA-256 for ripgrep archive: ${fileName}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hooman-rg-"));
  const finalPath = ripgrepPath();
  try {
    const archivePath = path.join(tempDir, fileName);
    const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${fileName}`;

    await downloadArchive(url, archivePath);
    const hash = await sha256File(archivePath);
    if (hash !== expectedHash) {
      throw new Error(
        `Ripgrep checksum mismatch for ${fileName}. Expected ${expectedHash}, got ${hash}.`,
      );
    }

    await extractArchive(archivePath, tempDir, config.extension);
    const extractedPath = path.join(
      tempDir,
      `ripgrep-${RIPGREP_VERSION}-${config.target}`,
      process.platform === "win32" ? "rg.exe" : "rg",
    );
    if (!(await isExistingFile(extractedPath))) {
      throw new Error(
        `Ripgrep archive did not include the expected binary at ${extractedPath}.`,
      );
    }

    await fs.mkdir(binPath(), { recursive: true });
    const tempTarget = `${finalPath}.tmp`;
    await fs.copyFile(extractedPath, tempTarget);
    if (process.platform !== "win32") {
      await fs.chmod(tempTarget, 0o755);
    }
    await fs.rm(finalPath, { force: true }).catch(() => {});
    await fs.rename(tempTarget, finalPath);
    return finalPath;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function ensureRipgrepPath(): Promise<string> {
  if (resolvedRipgrepPath) {
    return resolvedRipgrepPath;
  }

  const pending = (async () => {
    const system = lookupCommandPath(
      process.platform === "win32" ? "rg.exe" : "rg",
    );
    if (system && (await isExistingFile(system))) {
      return system;
    }

    const cached = ripgrepPath();
    if (await isExistingFile(cached)) {
      return cached;
    }

    return installManagedRipgrep();
  })();

  resolvedRipgrepPath = pending;
  try {
    return await pending;
  } catch (error) {
    resolvedRipgrepPath = undefined;
    throw error;
  }
}
