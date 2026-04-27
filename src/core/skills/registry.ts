import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseSkillFrontmatter } from "./metadata.ts";

const execFileAsync = promisify(execFile);

/** Vercel `skills` CLI package; uses latest every time. */
const SKILLS_CLI = "skills@latest";
/** Agent target for `skills add/list` — OpenClaw layout → `./skills/`. */
const SKILLS_AGENT = "openclaw";
const SKILLS_API_URL = "https://skills.sh";
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

type SkillsListJsonRow = {
  name: string;
  path: string;
  scope?: string;
  agents?: string[];
};

export type SkillListEntry = {
  /** Display title (skill `name` from SKILL.md) */
  name: string;
  /** Full description read using gray-matter */
  description?: string;
  /** Absolute path to the skill package root from `skills list --json`. */
  path: string;
};

export interface SkillSearchResult {
  name: string;
  slug: string;
  source: string;
  installs: number;
}

async function runNpxSkills(
  args: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, timeout = 300_000 } = options;
  return execFileAsync(NPX_BIN, ["--yes", SKILLS_CLI, ...args], {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    timeout,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

/**
 * Install / list / delete skills via the Vercel [`skills` CLI](https://github.com/vercel-labs/skills)
 * (`npx skills`), using OpenClaw scope (`./skills/`).
 */
export class Registry {
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async list(): Promise<SkillListEntry[]> {
    let stdout: string;
    try {
      const r = await runNpxSkills(["list", "--json", "-a", SKILLS_AGENT], {
        cwd: this.cwd,
      });
      stdout = r.stdout;
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      const detail = err.stderr ?? err.message ?? String(e);
      throw new Error(
        `skills list failed. Is Node/npm available?\n${stripAnsi(detail)}`,
      );
    }
    const text = stdout.trim();
    if (!text) {
      return [];
    }
    let rows: SkillsListJsonRow[];
    try {
      rows = JSON.parse(text) as SkillsListJsonRow[];
    } catch {
      throw new Error(
        `Unexpected skills list output (expected JSON):\n${text.slice(0, 500)}`,
      );
    }
    if (!Array.isArray(rows)) {
      return [];
    }
    const entries: SkillListEntry[] = [];
    for (const row of rows) {
      try {
        const folder = basename(row.path);
        const root = isAbsolute(row.path)
          ? resolve(row.path)
          : resolve(this.cwd, row.path);
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

  /**
   * `skills add <source> -y -a openclaw --copy` — supports owner/repo, Git URLs with tree paths, local paths, etc.
   */
  async install(source: string): Promise<void> {
    const raw = source.trim();
    if (!raw) {
      throw new Error(
        "Enter a skill source (e.g. owner/repo or a GitHub URL).",
      );
    }
    try {
      await runNpxSkills(["add", raw, "-y", "-a", SKILLS_AGENT, "--copy"], {
        cwd: this.cwd,
        timeout: 600_000,
      });
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      const detail = stripAnsi(
        err.stderr || err.stdout || err.message || String(e),
      );
      throw new Error(`skills add failed:\n${detail}`);
    }
  }

  /**
   * Remove by on-disk folder name (basename of `path` from `skills list --json`).
   *
   * We do **not** pass `--agent` so removal matches the CLI’s universal layout behavior.
   */
  async delete(folder: string): Promise<void> {
    const safe = folder.trim();
    if (!safe || /[\\/]/.test(safe) || safe.includes("..")) {
      throw new Error("Invalid skill name.");
    }
    try {
      await runNpxSkills(["remove", safe, "-y"], { cwd: this.cwd });
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      const detail = stripAnsi(
        err.stderr || err.stdout || err.message || String(e),
      );
      throw new Error(`skills remove failed:\n${detail}`);
    }

    await rm(join(this.cwd, "skills", safe), {
      recursive: true,
      force: true,
    }).catch(() => {});
  }

  /**
   * Search the public catalog at skills.sh (same API as the `skills` CLI `find` command).
   */
  async search(query: string): Promise<SkillSearchResult[]> {
    const q = query.trim();
    if (!q) {
      throw new Error("Enter a search term for the skills catalog.");
    }
    if (q.length < 2) {
      throw new Error("Use at least 2 characters to search.");
    }
    try {
      const url = `${SKILLS_API_URL}/api/search?q=${encodeURIComponent(q)}&limit=10`;
      const res = await fetch(url);
      if (!res.ok) {
        return [];
      }
      const data = (await res.json()) as {
        skills: Array<{
          skillId: string;
          name: string;
          installs: number;
          source: string;
        }>;
      };

      if (!Array.isArray(data.skills)) {
        throw new Error("Skills search did not return .skills[] in response");
      }

      return data.skills
        .map((skill) => ({
          name: skill.name,
          slug: `${skill.source.trim()}@${skill.skillId.trim()}`,
          source: skill.source || "",
          installs: skill.installs,
        }))
        .sort((a, b) => (b.installs || 0) - (a.installs || 0));
    } catch {
      return [];
    }
  }
}

export function create(cwd: string) {
  return new Registry(cwd);
}
