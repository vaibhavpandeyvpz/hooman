import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import handlebars from "handlebars";
import type { Config } from "../config.js";
import { getEnvironmentPromptContext } from "./environment.js";

const { compile } = handlebars;

/** Bundled markdown next to this module (`prompts/static/`). */
const STATIC_PROMPT_FILES = [
  "identity.md",
  "environment.md",
  "ltm.md",
  "todo.md",
  "thinking.md",
  "filesystem.md",
  "fetch.md",
  "web-search.md",
  "shell.md",
  "sleep.md",
  "bye.md",
  "daemon.md",
  "wiki.md",
  "skills.md",
  "subagents.md",
  "planning.md",
] as const;

const HARNESS_PROMPT_FILES = [
  { key: "behaviour", file: "behaviour.md" },
  { key: "communication", file: "communication.md" },
  { key: "execution", file: "execution.md" },
  { key: "guardrails", file: "guardrails.md" },
] as const;

export type SystemMode = "default" | "daemon" | "acp";

const SECTION_BREAK = "\n\n---\n\n";
const EXTRA_CWD_INSTRUCTIONS = "AGENTS.md";

/**
 * Loads `prompts/static/*.md` from the package, then `instructions.md` from disk,
 * concatenates them, and renders with Handlebars using `context`.
 */
export class System {
  private readonly path: string;
  private readonly config: Config;
  private readonly mode: SystemMode;
  private data = "";
  private sourceFingerprint = "";
  private compiledTemplate: ReturnType<typeof compile> | null = null;

  public constructor(
    path: string,
    config: Config,
    mode: SystemMode = "default",
  ) {
    this.path = path;
    this.config = config;
    this.mode = mode;
  }

  private staticPromptFiles(): readonly (typeof STATIC_PROMPT_FILES)[number][] {
    return STATIC_PROMPT_FILES.filter((file) => {
      switch (file) {
        case "ltm.md":
          return this.config.tools.ltm.enabled;
        case "fetch.md":
          return this.config.tools.fetch.enabled;
        case "web-search.md":
          return this.config.search.enabled;
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
        case "subagents.md":
          return this.config.tools.agents.enabled;
        case "daemon.md":
          return this.mode === "daemon";
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

  private readBundledHarnessPrompts(): string {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "harness");
    const parts: string[] = [];
    for (const { key, file } of HARNESS_PROMPT_FILES) {
      if (!this.config.prompts[key]) {
        continue;
      }
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

  private readCwdAgentsInstructions(): string {
    const path = join(process.cwd(), EXTRA_CWD_INSTRUCTIONS);
    if (!existsSync(path)) {
      return "";
    }
    return readFileSync(path, "utf8").trim();
  }

  /** Stats prompt sources so we only re-read disk + recompile Handlebars when files change. */
  private computeSourceFingerprint(): string {
    const parts: string[] = [];
    const pushPath = (label: string, filePath: string) => {
      if (!existsSync(filePath)) {
        parts.push(`${label}:missing`);
        return;
      }
      const st = statSync(filePath);
      parts.push(`${label}:${st.mtimeMs}:${st.size}`);
    };

    pushPath("instructions", this.path);
    const staticDir = join(dirname(fileURLToPath(import.meta.url)), "static");
    for (const file of this.staticPromptFiles()) {
      pushPath(`static:${file}`, join(staticDir, file));
    }
    const harnessDir = join(dirname(fileURLToPath(import.meta.url)), "harness");
    for (const { key, file } of HARNESS_PROMPT_FILES) {
      if (!this.config.prompts[key]) {
        continue;
      }
      pushPath(`harness:${file}`, join(harnessDir, file));
    }
    pushPath("agents-md", join(process.cwd(), EXTRA_CWD_INSTRUCTIONS));
    return parts.join("|");
  }

  private readRawText(): string {
    const instructions = existsSync(this.path)
      ? readFileSync(this.path, "utf8").trim()
      : "";
    const bundled = this.readBundledStaticPrompts();
    const harness = this.readBundledHarnessPrompts();
    const extra = this.readCwdAgentsInstructions();

    const blocks: string[] = [];
    if (bundled.length > 0) {
      blocks.push(bundled);
    }
    if (harness.length > 0) {
      blocks.push(harness);
    }
    if (instructions.length > 0) {
      blocks.push(instructions);
    }
    if (extra.length > 0) {
      blocks.push(extra);
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
      mode: this.mode,
    };
  }

  public async reload(): Promise<void> {
    const fp = this.computeSourceFingerprint();
    if (fp !== this.sourceFingerprint || this.compiledTemplate === null) {
      const raw = this.readRawText();
      this.compiledTemplate = compile(raw);
      this.sourceFingerprint = fp;
    }
    this.data = this.compiledTemplate(this.context()).trim();
  }
}
