import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_ROOT = dirname(fileURLToPath(import.meta.url));

export function bundledPromptPath(...parts: string[]): string {
  return join(PROMPTS_ROOT, ...parts);
}

export function hasBundledPrompt(...parts: string[]): boolean {
  return existsSync(bundledPromptPath(...parts));
}

export function readBundledPrompt(...parts: string[]): string {
  return readFileSync(bundledPromptPath(...parts), "utf8").trim();
}
