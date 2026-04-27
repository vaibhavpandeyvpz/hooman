import matter from "gray-matter";

export type SkillMetadata = {
  name: string;
  description?: string;
};

/**
 * Parse name and description from a SKILL.md file's YAML frontmatter.
 */
export function parseSkillFrontmatter(
  content: string,
  dirName: string,
): SkillMetadata {
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
