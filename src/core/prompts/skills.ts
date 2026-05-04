import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "../skills/metadata.js";
import type { Registry } from "../skills/registry.js";

/** Folder names under `src/core/skills/built-in/<id>/SKILL.md` (also copied to `dist/`). */
const BUILTIN_SKILLS = [
  "hooman-coding",
  "hooman-config",
  "hooman-mcp",
  "hooman-skills",
] as const;

const BUILTIN_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../skills/built-in",
);

/** Markdown for built-in skills; fixed at module load (paths match this install’s `built-in/` tree). */
const BUILTIN_SKILLS_SECTION: string = (() => {
  const header: string[] = [
    "## Built-in skills",
    "",
    "Shipped with hooman. When one matches the request, read its `SKILL.md` at the path shown and follow that guidance.",
    "",
  ];
  let any = false;
  for (const id of BUILTIN_SKILLS) {
    const mdPath = join(BUILTIN_ROOT, id, "SKILL.md");
    let raw: string;
    try {
      raw = readFileSync(mdPath, "utf-8");
    } catch {
      continue;
    }
    const { name, description } = parseSkillFrontmatter(raw, id);
    header.push(`- **${name}**`);
    header.push(`  - Description: ${description ?? "(see SKILL.md)"}`);
    header.push(`  - Path: \`${mdPath}\``);
    header.push("");
    any = true;
  }
  return any ? header.join("\n").trim() : "";
})();

/**
 * Builds the dynamic **Available skills** markdown block using
 * {@link Registry.list}, prefixed by a
 * static **Built-in skills** section from `src/core/skills/built-in/`.
 *
 * Mirrors {@link System}: call {@link reload}, then read {@link content}.
 */
export class Skills {
  private readonly registry: Registry;
  private data = "";

  public constructor(registry: Registry) {
    this.registry = registry;
  }

  get content(): string {
    return [BUILTIN_SKILLS_SECTION, this.data].filter(Boolean).join("\n\n");
  }

  public async reload(): Promise<void> {
    let entries;
    try {
      entries = await this.registry.list();
    } catch {
      this.data = [
        "## Available skills",
        "",
        "Installed skills could not be loaded. Check `~/.hooman/skills` and try again later.",
        "",
      ].join("\n");
      return;
    }

    const lines: string[] = [
      "## Available skills",
      "",
      "Installed skills for this environment. When one matches the user's request or would materially help the current turn, read its `SKILL.md` at the path shown (for example with your file-reading tool) and follow that guidance.",
      "",
    ];

    if (entries.length === 0) {
      lines.push(
        "No skills are installed yet. Add skill folders under `~/.hooman/skills`.",
        "",
      );
      this.data = lines.join("\n").trim();
      return;
    }

    const sorted = [...entries].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

    for (const e of sorted) {
      lines.push(`- **${e.name}**`);
      lines.push(`  - Description: ${e.description ?? "(see SKILL.md)"}`);
      lines.push(`  - Path: \`${e.path}\``);
      lines.push("");
    }

    this.data = lines.join("\n").trim();
  }
}
