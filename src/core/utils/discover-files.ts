import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Resolve the nearest git root for a cwd. Falls back to cwd when outside git.
 */
export function findGitRoot(cwd: string = process.cwd()): string {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }
    current = parent;
  }
}

/**
 * Candidate file paths from git root -> cwd for a given filename.
 */
export function candidateWalkUpPaths(
  filename: string,
  cwd: string = process.cwd(),
): string[] {
  const resolvedCwd = resolve(cwd);
  const root = findGitRoot(resolvedCwd);
  const directories: string[] = [];
  let current = resolvedCwd;
  while (true) {
    directories.push(current);
    if (current === root) {
      break;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  directories.reverse();
  return directories.map((dir) => join(dir, filename));
}

/**
 * Existing file paths from git root -> cwd for a given filename.
 */
export function discoverWalkUpFiles(
  filename: string,
  cwd: string = process.cwd(),
): string[] {
  return candidateWalkUpPaths(filename, cwd).filter((path) => existsSync(path));
}
