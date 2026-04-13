import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "handlebars";
import type { Config } from "../config.ts";
import type { Skills } from "./skills.ts";

/** Bundled markdown next to this module (`prompts/static/`). */
const STATIC_PROMPT_FILES = [
  "identity.md",
  "ltm.md",
  "thinking.md",
  "filesystem.md",
  "fetch.md",
  "shell.md",
  "skills.md",
] as const;

const SECTION_BREAK = "\n\n---\n\n";

/**
 * Loads `prompts/static/*.md` from the package, then `instructions.md` from disk,
 * concatenates them, and renders with Handlebars using `context`.
 */
export class System {
  private readonly path: string;
  private readonly config: Config;
  private data = "";

  public constructor(path: string, config: Config) {
    this.path = path;
    this.config = config;
  }

  private staticPromptFiles(): readonly (typeof STATIC_PROMPT_FILES)[number][] {
    return STATIC_PROMPT_FILES.filter(
      (file) => file !== "ltm.md" || this.config.ltm.enabled,
    );
  }

  private readBundledStaticPrompts(): string {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "static");
    const parts: string[] = [];
    for (const file of this.staticPromptFiles()) {
      const full = join(dir, file);
      if (!existsSync(full)) {
        continue;
      }
      const text = readFileSync(full, "utf8").trim();
      if (text.length > 0) {
        parts.push(text);
      }
    }
    return parts.join("\n\n");
  }

  private readRawText(): string {
    const instructions = existsSync(this.path)
      ? readFileSync(this.path, "utf8").trim()
      : "";
    const bundled = this.readBundledStaticPrompts();

    const blocks: string[] = [];
    if (bundled.length > 0) {
      blocks.push(bundled);
    }
    if (instructions.length > 0) {
      blocks.push(instructions);
    }
    if (blocks.length === 0) {
      return "";
    }
    return blocks.join(SECTION_BREAK);
  }

  get content(): string {
    return this.data;
  }

  /** Plain object for Handlebars (`{{name}}`, `{{llm.model}}`, …). */
  private context(): Record<string, unknown> {
    return {
      name: this.config.name,
      llm: this.config.llm,
      ltm: this.config.ltm,
      compaction: this.config.compaction,
    };
  }

  public async reload(): Promise<void> {
    const raw = this.readRawText();
    const template = compile(raw);
    this.data = template(this.context()).trim();
  }
}
