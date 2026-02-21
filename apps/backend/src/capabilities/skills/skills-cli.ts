import { spawn } from "child_process";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { env } from "../../env.js";

const PROJECT_ROOT = env.SKILLS_CWD;

/** Default agent for skills (user requested "amp"). */
const SKILLS_AGENT = "amp";

/** Project-local skills dir: list and read from <project>/.agents/skills/<skill-name>. */
const PROJECT_SKILLS_DIR = join(PROJECT_ROOT, ".agents", "skills");

export interface SkillEntry {
  id: string;
  name: string;
  description?: string;
}

export interface SkillsRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const SKILL_MD = "SKILL.md";

/**
 * Parse name and description from a SKILL.md file's YAML frontmatter.
 */
function parseSkillFrontmatter(
  content: string,
  dirName: string,
): { name: string; description?: string } {
  try {
    const { data } = matter(content);
    const name =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim()
        : dirName;
    const description =
      typeof data?.description === "string" && data.description.trim()
        ? data.description.trim()
        : undefined;
    return { name, description };
  } catch {
    return { name: dirName };
  }
}

/**
 * List installed skills by reading the project .agents/skills dir and parsing each skill's SKILL.md frontmatter (name, description).
 */
export async function listSkillsFromFs(): Promise<SkillEntry[]> {
  try {
    const entries = await readdir(PROJECT_SKILLS_DIR, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    const results: SkillEntry[] = [];
    for (const id of dirs) {
      const skillPath = join(PROJECT_SKILLS_DIR, id, SKILL_MD);
      try {
        const raw = await readFile(skillPath, "utf-8");
        const { name, description } = parseSkillFrontmatter(raw, id);
        results.push({ id, name, description });
      } catch {
        results.push({ id, name: id });
      }
    }
    return results;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

/** Safe skill id for path (no path traversal). */
function isSafeSkillId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(id) && id.length > 0 && id.length <= 200;
}

/**
 * Read SKILL.md content for a skill by id, with frontmatter (name/description) stripped for display.
 * Returns null if not found or invalid id.
 */
export async function getSkillContent(skillId: string): Promise<string | null> {
  if (!isSafeSkillId(skillId)) return null;
  try {
    const path = join(PROJECT_SKILLS_DIR, skillId, SKILL_MD);
    const raw = await readFile(path, "utf-8");
    const { content } = matter(raw);
    return typeof content === "string" ? content.trim() : "";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Run npx skills with args. Uses project root as cwd and AGENTS_HOME so installs go to project .agents/skills.
 */
export async function runSkills(
  args: string[],
  options?: { cwd?: string },
): Promise<SkillsRunResult> {
  const cwd = options?.cwd ?? PROJECT_ROOT;
  const agentsHome = join(cwd, ".agents");

  return new Promise((resolve) => {
    const proc = spawn("npx", ["skills", ...args], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AGENTS_HOME: agentsHome },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? null });
    });
    proc.on("error", (err) => {
      stderr += (err as Error).message;
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

/** Add a skill package to project .agents/skills. skills => --skill x --skill y, -y non-interactive */
export async function addSkill(options: {
  package: string;
  skills?: string[];
}): Promise<SkillsRunResult> {
  const args = ["add", options.package.trim(), "-a", SKILLS_AGENT, "--yes"];
  for (const s of options.skills ?? []) {
    const t = String(s).trim();
    if (t) args.push("--skill", t);
  }
  return runSkills(args);
}

/** Remove installed skills by name from project .agents/skills. */
export async function removeSkills(
  skillNames: string[],
): Promise<SkillsRunResult> {
  if (skillNames.length === 0) {
    return { stdout: "", stderr: "No skills specified.", code: 1 };
  }
  const args = [
    "remove",
    ...skillNames.map((s) => s.trim()).filter(Boolean),
    "-a",
    SKILLS_AGENT,
  ];
  return runSkills(args);
}
