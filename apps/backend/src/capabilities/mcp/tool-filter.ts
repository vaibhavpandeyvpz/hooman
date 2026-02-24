import { minimatch } from "minimatch";

/**
 * Filter tool names by comma-separated glob patterns with optional negation.
 * Empty/null/whitespace filterStr means "*" (include all).
 * Patterns starting with ! are exclusions.
 */
export function filterToolNames(
  toolNames: string[],
  filterStr: string | undefined | null,
): string[] {
  const raw = (filterStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const patterns = raw.length > 0 ? raw : ["*"];

  const positive = patterns.filter((p) => !p.startsWith("!"));
  const negative = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => p.slice(1));
  const includePatterns = positive.length > 0 ? positive : ["*"];

  return toolNames.filter((name) => {
    const included =
      includePatterns.some((p) => minimatch(name, p)) ||
      (positive.length === 0 && negative.length === 0);
    const excluded = negative.some((n) => minimatch(name, n));
    return included && !excluded;
  });
}
