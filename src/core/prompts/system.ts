import { existsSync, readFileSync, statSync } from "node:fs";
import handlebars from "handlebars";
import type { Config } from "../config.js";
import {
  bundledPromptPath,
  hasBundledPrompt,
  readBundledPrompt,
} from "./bundled.js";
import { getEnvironmentPromptContext } from "./environment.js";
import {
  candidateAgentInstructionPaths,
  readAgentInstructions,
} from "./runtime.js";

const { compile } = handlebars;

/** Bundled markdown next to this module (`prompts/static/`). */
const STATIC_PROMPT_FILES = [
  "identity.md",
  "environment.md",
  "todo.md",
  "thinking.md",
  "filesystem.md",
  "fetch.md",
  "web-search.md",
  "shell.md",
  "sleep.md",
  "bye.md",
  "daemon.md",
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

/**
 * Loads `prompts/static/*.md` from the package plus `instructions.md` from disk,
 * renders those template-backed sources with Handlebars, then appends `AGENTS.md`
 * content as literal text.
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
        case "subagents.md":
          return this.config.tools.agents.enabled;
        case "daemon.md":
          return this.mode === "daemon";
        default:
          return true;
      }
    });
  }

  private readBundledStaticPrompts(): string {
    const parts: string[] = [];
    for (const file of this.staticPromptFiles()) {
      if (!hasBundledPrompt("static", file)) {
        continue;
      }
      const text = readBundledPrompt("static", file);
      if (text.length > 0) {
        parts.push(text);
      }
    }
    return parts.join("\n\n");
  }

  private readBundledHarnessPrompts(): string {
    const parts: string[] = [];
    for (const { key, file } of HARNESS_PROMPT_FILES) {
      if (!this.config.prompts[key]) {
        continue;
      }
      if (!hasBundledPrompt("harness", file)) {
        continue;
      }
      const text = readBundledPrompt("harness", file);
      if (text.length > 0) {
        parts.push(text);
      }
    }
    return parts.join("\n\n");
  }

  private readCwdAgentsInstructions(): string {
    return readAgentInstructions();
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
    for (const file of this.staticPromptFiles()) {
      pushPath(`static:${file}`, bundledPromptPath("static", file));
    }
    for (const { key, file } of HARNESS_PROMPT_FILES) {
      if (!this.config.prompts[key]) {
        continue;
      }
      pushPath(`harness:${file}`, bundledPromptPath("harness", file));
    }
    for (const path of candidateAgentInstructionPaths()) {
      pushPath(`agents-md:${path}`, path);
    }
    return parts.join("|");
  }

  private readTemplateText(): string {
    const instructions = existsSync(this.path)
      ? readFileSync(this.path, "utf8").trim()
      : "";
    const bundled = this.readBundledStaticPrompts();
    const harness = this.readBundledHarnessPrompts();

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
      compaction: this.config.compaction,
      mode: this.mode,
    };
  }

  public async reload(): Promise<void> {
    const fp = this.computeSourceFingerprint();
    if (fp !== this.sourceFingerprint || this.compiledTemplate === null) {
      const raw = this.readTemplateText();
      this.compiledTemplate = compile(raw);
      this.sourceFingerprint = fp;
    }
    const renderedTemplate = this.compiledTemplate(this.context()).trim();
    const agentsInstructions = this.readCwdAgentsInstructions();
    this.data = [renderedTemplate, agentsInstructions]
      .filter((block) => block.length > 0)
      .join(SECTION_BREAK);
  }
}
