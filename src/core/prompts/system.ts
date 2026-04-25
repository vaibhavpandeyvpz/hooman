import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "handlebars";
import type { Config } from "../config.ts";
import { getEnvironmentPromptContext } from "./environment.ts";

/** Bundled markdown next to this module (`prompts/static/`). */
const STATIC_PROMPT_FILES = [
  "identity.md",
  "environment.md",
  "ltm.md",
  "todo.md",
  "thinking.md",
  "filesystem.md",
  "fetch.md",
  "shell.md",
  "sleep.md",
  "wiki.md",
  "skills.md",
  "subagents.md",
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
    return STATIC_PROMPT_FILES.filter((file) => {
      switch (file) {
        case "ltm.md":
          return this.config.tools.ltm.enabled;
        case "fetch.md":
          return this.config.tools.fetch.enabled;
        case "todo.md":
          return this.config.tools.todo.enabled;
        case "filesystem.md":
          return this.config.tools.filesystem.enabled;
        case "shell.md":
          return this.config.tools.shell.enabled;
        case "sleep.md":
          return this.config.tools.sleep.enabled;
        case "wiki.md":
          return this.config.tools.wiki.enabled;
        case "skills.md":
          return this.config.tools.skills.enabled;
        case "subagents.md":
          return this.config.tools.agents.enabled;
        case "thinking.md":
        default:
          return true;
      }
    });
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
      environment: getEnvironmentPromptContext(),
      ltm: this.config.tools.ltm,
      wiki: this.config.tools.wiki,
      compaction: this.config.compaction,
    };
  }

  public async reload(): Promise<void> {
    const raw = this.readRawText();
    const template = compile(raw);
    this.data = template(this.context()).trim();
  }
}
