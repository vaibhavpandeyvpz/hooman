import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseSkillFrontmatter } from "./metadata.js";

export type SkillListEntry = {
  /** Display title (skill `name` from SKILL.md) */
  name: string;
  /** Full description read using gray-matter */
  description?: string;
  /** Absolute path to the skill's SKILL.md file. */
  path: string;
};

/**
 * List / delete local Hooman skills from `~/.hooman/skills`.
 */
export class Registry {
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async list(): Promise<SkillListEntry[]> {
    const skillsDir = join(this.cwd, "skills");
    let dirs;
    try {
      dirs = await readdir(skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const entries: SkillListEntry[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) {
        continue;
      }
      try {
        const folder = dir.name;
        const root = resolve(skillsDir, folder);
        const md = resolve(join(root, "SKILL.md"));
        const raw = await readFile(md, "utf-8");
        const { name, description } = parseSkillFrontmatter(raw, folder);
        entries.push({
          name,
          description,
          path: md,
        });
      } catch {
        continue;
      }
    }
    return entries;
  }

  async delete(folder: string): Promise<void> {
    const safe = folder.trim();
    if (!safe || /[\\/]/.test(safe) || safe.includes("..")) {
      throw new Error("Invalid skill name.");
    }
    await rm(join(this.cwd, "skills", safe), {
      recursive: true,
      force: true,
    }).catch(() => {});
  }
}

export function create(cwd: string) {
  return new Registry(cwd);
}
