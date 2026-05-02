import os from "node:os";
import path from "node:path";
import { getCwd } from "./cwd-context.js";

function expandHome(inputPath: string): string {
  if (inputPath === "~" || inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

/** Resolve a user-supplied path the same way filesystem tools do (cwd + home). */
export function normalizeUserPath(inputPath: string): string {
  let value = inputPath.trim().replace(/^["']|["']$/g, "");

  if (process.platform === "win32" && /^\/[a-zA-Z]\//.test(value)) {
    const drive = value[1]!.toUpperCase();
    value = `${drive}:${value.slice(2).replace(/\//g, "\\")}`;
  }

  value = expandHome(value);

  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(getCwd(), value);
}

/** True if `filePath` is exactly `dirPath` or lies under it (after resolve). */
export function isResolvedPathInsideDir(
  filePath: string,
  dirPath: string,
): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(dirPath);
  const prefix = resolvedDir.endsWith(path.sep)
    ? resolvedDir
    : `${resolvedDir}${path.sep}`;
  return resolvedFile === resolvedDir || resolvedFile.startsWith(prefix);
}
