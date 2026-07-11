import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { candidateWalkUpPaths } from "../../utils/discover-files.js";

const AGENTS_FILENAME = "AGENTS.md";
const AGENTS_CHAR_BUDGET = 32_000;
const AGENTS_TRUNCATION_MARKER =
  "<!-- Some AGENTS.md files were truncated or omitted to fit the 32k character budget. -->";

type AgentsInstructionFile = {
  path: string;
  content: string;
};

export type AgentInstructionResolution = {
  paths: string[];
  content: string;
};

export function candidateAgentInstructionPaths(
  cwd: string = process.cwd(),
): string[] {
  return candidateWalkUpPaths(AGENTS_FILENAME, cwd);
}

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const rel = relative(resolve(baseDir), resolve(candidatePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function discoverAgentInstructionFiles(
  cwd: string = process.cwd(),
): AgentsInstructionFile[] {
  const discovered: AgentsInstructionFile[] = [];
  for (const path of candidateAgentInstructionPaths(cwd)) {
    if (!existsSync(path)) {
      continue;
    }
    const content = readFileSync(path, "utf8").trim();
    if (content.length === 0) {
      continue;
    }
    discovered.push({ path, content });
  }
  return discovered;
}

function renderAgentInstructionFiles(
  files: readonly AgentsInstructionFile[],
): string {
  if (files.length === 0) {
    return "";
  }
  let remaining = AGENTS_CHAR_BUDGET;
  let didTruncate = false;
  const budgeted: Array<AgentsInstructionFile | undefined> = Array.from({
    length: files.length,
  });
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (file === undefined) {
      continue;
    }
    const annotation = `<!-- From: ${file.path} -->\n`;
    const separator = i < files.length - 1 ? "\n\n" : "";
    remaining -= annotation.length + separator.length;
    if (remaining <= 0) {
      budgeted[i] = { path: file.path, content: "" };
      remaining = 0;
      didTruncate = true;
      continue;
    }
    let content = file.content;
    if (content.length > remaining) {
      content = content.slice(0, remaining).trimEnd();
      didTruncate = true;
    }
    remaining -= content.length;
    budgeted[i] = { path: file.path, content };
  }
  const rendered = budgeted
    .filter(
      (file): file is AgentsInstructionFile =>
        file !== undefined && file.content.length > 0,
    )
    .map((file) => `<!-- From: ${file.path} -->\n${file.content}`)
    .join("\n\n");
  return didTruncate ? `${AGENTS_TRUNCATION_MARKER}\n${rendered}` : rendered;
}

export function readAgentInstructions(cwd: string = process.cwd()): string {
  return renderAgentInstructionFiles(discoverAgentInstructionFiles(cwd));
}

export function resolveAgentInstructionsForFile(
  filePath: string,
  options?: {
    cwd?: string;
    excludePaths?: readonly string[];
  },
): AgentInstructionResolution {
  const cwd = resolve(options?.cwd ?? process.cwd());
  const target = resolve(filePath);
  const startDir = dirname(target);
  if (!isWithinDirectory(cwd, startDir) || startDir === cwd) {
    return { paths: [], content: "" };
  }
  const exclude = new Set(
    (options?.excludePaths ?? []).map((item) => resolve(item)),
  );
  const directories: string[] = [];
  let current = startDir;
  while (isWithinDirectory(cwd, current) && current !== cwd) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  directories.reverse();
  const files: AgentsInstructionFile[] = [];
  for (const dir of directories) {
    const instructionPath = join(dir, AGENTS_FILENAME);
    const resolvedInstructionPath = resolve(instructionPath);
    if (
      resolvedInstructionPath === target ||
      exclude.has(resolvedInstructionPath)
    ) {
      continue;
    }
    if (!existsSync(resolvedInstructionPath)) {
      continue;
    }
    const content = readFileSync(resolvedInstructionPath, "utf8").trim();
    if (content.length === 0) {
      continue;
    }
    files.push({ path: resolvedInstructionPath, content });
  }
  return {
    paths: files.map((file) => file.path),
    content: renderAgentInstructionFiles(files),
  };
}
