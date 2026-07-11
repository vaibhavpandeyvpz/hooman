import { existsSync, readFileSync } from "node:fs";
import { candidateWalkUpPaths } from "../../utils/discover-files.js";

const DESIGN_FILENAME = "DESIGN.md";
const DESIGN_CHAR_BUDGET = 32_000;
const DESIGN_TRUNCATION_MARKER =
  "<!-- Some DESIGN.md files were truncated or omitted to fit the 32k character budget. -->";

type DesignSystemFile = {
  path: string;
  content: string;
};

export type DesignSystemResolution = {
  paths: string[];
  content: string;
};

export function candidateDesignSystemPaths(
  cwd: string = process.cwd(),
): string[] {
  return candidateWalkUpPaths(DESIGN_FILENAME, cwd);
}

function discoverDesignSystemFiles(
  cwd: string = process.cwd(),
): DesignSystemFile[] {
  const discovered: DesignSystemFile[] = [];
  for (const path of candidateDesignSystemPaths(cwd)) {
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

function renderDesignSystemFiles(files: readonly DesignSystemFile[]): string {
  if (files.length === 0) {
    return "";
  }
  let remaining = DESIGN_CHAR_BUDGET;
  let didTruncate = false;
  const budgeted: Array<DesignSystemFile | undefined> = Array.from({
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
      (file): file is DesignSystemFile =>
        file !== undefined && file.content.length > 0,
    )
    .map((file) => `<!-- From: ${file.path} -->\n${file.content}`)
    .join("\n\n");
  return didTruncate ? `${DESIGN_TRUNCATION_MARKER}\n${rendered}` : rendered;
}

/**
 * Discover and render `DESIGN.md` files from git root → cwd (same walk as
 * `AGENTS.md`). Empty string when none exist.
 */
export function readDesignSystemInstructions(
  cwd: string = process.cwd(),
): string {
  const body = renderDesignSystemFiles(discoverDesignSystemFiles(cwd));
  if (!body) {
    return "";
  }
  return `## Active design system (DESIGN.md)\n\n${body}`;
}

export function resolveDesignSystemInstructions(
  cwd: string = process.cwd(),
): DesignSystemResolution {
  const files = discoverDesignSystemFiles(cwd);
  return {
    paths: files.map((file) => file.path),
    content: renderDesignSystemFiles(files),
  };
}
