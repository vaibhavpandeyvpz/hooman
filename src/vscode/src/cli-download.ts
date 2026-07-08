import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const GITHUB_REPO = "vaibhavpandeyvpz/hooman";
const DOWNLOAD_TIMEOUT_MS = 600_000;

/** Minimal logging surface (satisfied by `vscode.LogOutputChannel`). */
export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

const NOOP_LOGGER: Logger = { info: () => {}, error: () => {} };

/** Result of ensuring a downloaded CLI: paths the launcher needs. */
export interface DownloadedCli {
  /** Absolute path to the CLI entry (`dist/cli.js`). */
  cliPath: string;
}

/** `~/.hooman`, honouring the same `HOOMAN_HOME` override as the CLI. */
function hoomanHome(): string {
  const override = process.env.HOOMAN_HOME?.trim();
  return override && override.length > 0
    ? override
    : path.join(os.homedir(), ".hooman");
}

/** Map the current system to a release asset target, or throw if unsupported. */
export function resolveTarget(): string {
  const key = `${process.platform}-${process.arch}`;
  const supported = new Set([
    "darwin-arm64",
    "darwin-x64",
    "linux-x64",
    "linux-arm64",
    "win32-x64",
  ]);
  if (!supported.has(key)) {
    throw new Error(
      `No prebuilt Hooman CLI is available for this system (${key}).`,
    );
  }
  return key;
}

function cliDir(version: string): string {
  return path.join(hoomanHome(), "cli", version);
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(dest),
  );
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  return response.text();
}

async function sha256File(file: string): Promise<string> {
  const data = await fs.readFile(file);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Ensure the prebuilt CLI for `version` is downloaded and extracted under
 * `~/.hooman/cli/<version>/`, fetching the platform-specific tarball from the
 * matching GitHub release (verified against its `.sha256`) when absent.
 * Downloads run once and are cached; concurrent callers within the extension
 * share a single in-flight download.
 */
export async function ensureDownloadedCli(
  version: string,
  log: Logger = NOOP_LOGGER,
): Promise<DownloadedCli> {
  const dir = cliDir(version);
  const result: DownloadedCli = {
    cliPath: path.join(dir, "dist", "cli.js"),
  };
  if (existsSync(result.cliPath)) {
    return result;
  }

  const target = resolveTarget();
  const asset = `hoomanjs-cli-${version}-${target}.tar.gz`;
  const base = `https://github.com/${GITHUB_REPO}/releases/download/v${version}`;
  const tarballUrl = `${base}/${asset}`;
  const sha256Url = `${tarballUrl}.sha256`;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Hooman: downloading agent runtime (${target})…`,
      cancellable: false,
    },
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hooman-cli-"));
      try {
        log.info(`Downloading Hooman CLI: ${tarballUrl}`);
        const tarballPath = path.join(tmpDir, asset);
        await downloadToFile(tarballUrl, tarballPath);

        const shaText = await fetchText(sha256Url);
        const expected = shaText.trim().split(/\s+/)[0]?.toLowerCase();
        const actual = (await sha256File(tarballPath)).toLowerCase();
        if (!expected || expected !== actual) {
          throw new Error(
            `Checksum mismatch for ${asset} (expected ${expected ?? "none"}, got ${actual}).`,
          );
        }

        const extractDir = path.join(tmpDir, "extract");
        await fs.mkdir(extractDir, { recursive: true });
        await execFileAsync("tar", ["-xzf", tarballPath, "-C", extractDir]);

        // Atomic-ish publish: extract to a temp sibling then rename into place.
        await fs.mkdir(path.dirname(dir), { recursive: true });
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        await fs.rename(extractDir, dir);
        log.info(`Hooman CLI ready at ${dir}`);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  if (!existsSync(result.cliPath)) {
    throw new Error(`Downloaded Hooman CLI is missing ${result.cliPath}.`);
  }
  return result;
}
