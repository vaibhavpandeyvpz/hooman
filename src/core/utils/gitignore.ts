import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { findGitRoot } from "./discover-files.js";

type GitignoreMatcher = {
  root: string;
  matcher: Ignore;
  loadedFiles: string[];
  signature: string;
};

type GitignoreProbeOptions = {
  isDirectory?: boolean;
};

const GITIGNORE_FILENAME = ".gitignore";
const gitignoreMatcherCache = new Map<string, GitignoreMatcher>();

function normalizeRelativePath(input: string): string {
  const normalized = input.replaceAll("\\", "/");
  return normalized === "." ? "" : normalized;
}

async function fileSignature(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

async function listGitignoreFiles(
  targetPath: string,
  options?: GitignoreProbeOptions,
): Promise<{
  root: string;
  files: string[];
}> {
  const resolvedTarget = path.resolve(targetPath);
  const targetDirectory = options?.isDirectory
    ? resolvedTarget
    : path.dirname(resolvedTarget);
  const root = findGitRoot(targetDirectory);
  const files: string[] = [];
  let current = root;

  for (;;) {
    files.push(path.join(current, GITIGNORE_FILENAME));
    if (current === targetDirectory) {
      break;
    }
    const relative = path.relative(current, targetDirectory);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      break;
    }
    current = path.join(current, relative.split(path.sep)[0]!);
  }

  return { root, files };
}

async function buildMatcher(
  targetPath: string,
  options?: GitignoreProbeOptions,
): Promise<GitignoreMatcher> {
  const { root, files } = await listGitignoreFiles(targetPath, options);
  const matcher = ignore();
  matcher.add(".git/");
  const loadedFiles: string[] = [];
  const signatureParts: string[] = [];

  for (const filePath of files) {
    const signature = await fileSignature(filePath);
    if (!signature) {
      continue;
    }
    const contents = await fs.readFile(filePath, "utf8");
    const parent = path.dirname(filePath);
    const baseRelative = normalizeRelativePath(path.relative(root, parent));
    if (baseRelative.length === 0) {
      matcher.add(contents);
    } else {
      const scoped = contents
        .split(/\r?\n/)
        .map((line) => {
          if (line.length === 0 || line.startsWith("#")) {
            return line;
          }
          const isNegated = line.startsWith("!");
          const raw = isNegated ? line.slice(1) : line;
          if (raw.startsWith("/")) {
            return `${isNegated ? "!" : ""}${baseRelative}${raw}`;
          }
          return `${isNegated ? "!" : ""}${baseRelative}/${raw}`;
        })
        .join("\n");
      matcher.add(scoped);
    }
    loadedFiles.push(filePath);
    signatureParts.push(signature);
  }

  return {
    root,
    matcher,
    loadedFiles,
    signature: signatureParts.join("|"),
  };
}

async function getMatcher(
  targetPath: string,
  options?: GitignoreProbeOptions,
): Promise<GitignoreMatcher> {
  const resolvedTarget = path.resolve(targetPath);
  const targetDirectory = options?.isDirectory
    ? resolvedTarget
    : path.dirname(resolvedTarget);
  const root = findGitRoot(targetDirectory);
  const cached = gitignoreMatcherCache.get(root);
  const next = await buildMatcher(resolvedTarget, options);
  if (cached && cached.signature === next.signature) {
    return cached;
  }
  gitignoreMatcherCache.set(root, next);
  return next;
}

export function clearGitignoreMatcherCache(): void {
  gitignoreMatcherCache.clear();
}

export async function isPathGitignored(
  targetPath: string,
  options?: GitignoreProbeOptions,
): Promise<boolean> {
  const resolvedTarget = path.resolve(targetPath);
  const { matcher, root } = await getMatcher(resolvedTarget, options);
  let relative = normalizeRelativePath(path.relative(root, resolvedTarget));

  if (relative.length === 0) {
    return false;
  }

  if (options?.isDirectory && !relative.endsWith("/")) {
    relative = `${relative}/`;
  }

  return matcher.ignores(relative);
}

export async function assertPathNotGitignored(
  targetPath: string,
  options?: GitignoreProbeOptions,
): Promise<void> {
  if (await isPathGitignored(targetPath, options)) {
    throw new Error(
      `Access denied: path is ignored by .gitignore: ${targetPath}`,
    );
  }
}

export async function createGitignorePredicate(rootPath: string): Promise<{
  root: string;
  ignoresPath(targetPath: string, options?: GitignoreProbeOptions): boolean;
}> {
  const resolvedRoot = path.resolve(rootPath);
  const { matcher, root } = await getMatcher(resolvedRoot, {
    isDirectory: true,
  });

  return {
    root,
    ignoresPath(targetPath: string, options?: GitignoreProbeOptions): boolean {
      const resolvedTarget = path.resolve(targetPath);
      let relative = normalizeRelativePath(path.relative(root, resolvedTarget));
      if (relative.length === 0) {
        return false;
      }
      if (options?.isDirectory && !relative.endsWith("/")) {
        relative = `${relative}/`;
      }
      return matcher.ignores(relative);
    },
  };
}
