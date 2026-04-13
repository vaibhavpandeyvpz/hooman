import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Registry } from "../skills/registry.ts";

/**
 * Builds the dynamic **Available skills** markdown block using
 * {@link Registry.list} (same source as the skills CLI).
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
    return this.data;
  }

  public async reload(): Promise<void> {
    let entries;
    try {
      entries = await this.registry.list();
    } catch {
      this.data = [
        "## Available skills",
        "",
        "The skills list could not be loaded (for example if `npx skills` is unavailable). Skills management tools may still work; try again later.",
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
        "No skills are installed yet. Use the skills management tools to search and install packages, or add them under your agent skills directory.",
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
      lines.push(`  - Description: ${e.description}`);
      lines.push(`  - Path: \`${e.path}\``);
      lines.push("");
    }

    this.data = lines.join("\n").trim();
  }
}
