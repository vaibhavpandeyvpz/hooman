import { tool, type ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import { ensureRipgrepPath } from "./bootstrap.js";
import { runContentMode, runPathsMode } from "./exec.js";

function createGrepSchema() {
  return z.object({
    pattern: z.string().min(1).describe("Regex pattern to search for."),
    path: z
      .string()
      .optional()
      .default(".")
      .describe("Directory or file path to search from."),
    output_mode: z
      .enum(["paths", "content", "files_with_matches", "count"])
      .optional()
      .default("paths")
      .describe("Output mode for search results."),
    glob: z
      .string()
      .optional()
      .describe("Include only files matching this glob (ripgrep --glob)."),
    type: z
      .string()
      .optional()
      .describe("Restrict to a ripgrep file type (e.g. ts, js, py)."),
    exclude_patterns: z
      .array(z.string())
      .optional()
      .describe("Glob patterns to exclude from results."),
    context: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Context lines around matches."),
    before: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Lines before each match."),
    after: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Lines after each match."),
    case_insensitive: z
      .boolean()
      .optional()
      .describe("Search case-insensitively (ripgrep -i)."),
    fixed_strings: z
      .boolean()
      .optional()
      .describe("Treat pattern as a literal string (ripgrep -F)."),
    multiline: z
      .boolean()
      .optional()
      .describe("Enable multiline matching (ripgrep -U --multiline-dotall)."),
    no_ignore: z
      .boolean()
      .optional()
      .describe("Ignore .gitignore/.ignore rules during search."),
    head_limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of results to return."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Skip the first N results before returning output."),
    max_results: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Compatibility alias for head_limit."),
  });
}

export function createGrepTools() {
  const schema = createGrepSchema();
  return [
    tool({
      name: "grep",
      description:
        "Search paths or file contents using ripgrep. Supports search_files-style filename matching and richer content search modes.",
      inputSchema: schema,
      callback: async (input, context?: ToolContext) => {
        const rgPath = await ensureRipgrepPath();
        if (input.output_mode === "paths") {
          return runPathsMode(rgPath, input, context);
        }
        return runContentMode(rgPath, input.output_mode, input, context);
      },
    }),
  ];
}
