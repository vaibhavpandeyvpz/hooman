import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { app } from "electron";

function storePath(): string {
  return path.join(app.getPath("userData"), "last-project.json");
}

/**
 * The folder a new session should default to: the last folder opened in a
 * previous run, or the user's home directory the first time (or once that
 * folder no longer exists) — mirrors editors like VS Code, which never make
 * the user pick a folder before they can start chatting.
 */
export async function getDefaultCwd(): Promise<string> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const { cwd } = JSON.parse(raw) as { cwd?: string };
    if (cwd && existsSync(cwd)) return cwd;
  } catch {
    // No prior selection recorded yet, or the file is unreadable/corrupt.
  }
  return homedir();
}

export async function setLastProject(cwd: string): Promise<void> {
  await writeFile(storePath(), JSON.stringify({ cwd }), "utf8");
}
