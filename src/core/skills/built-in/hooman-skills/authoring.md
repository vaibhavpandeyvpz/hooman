# Authoring And Editing Hooman Skills

Reference for creating, updating, and manually installing skills under `~/.hooman/skills`.

## SKILL.md Shape

Every `SKILL.md` should start with YAML frontmatter:

```markdown
---
name: skill-name
description: What this skill does and when Hooman should use it.
---

# Skill Title

Instructions for the agent.
```

Rules:

- `name` should be lowercase words separated by hyphens when possible.
- `description` should be specific and include trigger scenarios, because Hooman uses it to decide when the skill applies.
- Keep the main `SKILL.md` focused. Put long references in nearby files such as `reference.md` and link to them.
- Use relative links only inside the same skill directory.

## Creating A Skill Manually

Create a new skill by making a directory under `~/.hooman/skills`:

```text
~/.hooman/skills/<folder>/SKILL.md
```

Use a safe folder name: lowercase letters, numbers, and hyphens; no slashes, no `..`, no spaces.

Minimal example:

```markdown
---
name: pull-request-review
description: Review pull requests for correctness, maintainability, tests, and project conventions. Use when the user asks to review a PR, diff, branch, or code changes.
---

# Pull Request Review

When reviewing code, lead with findings ordered by severity. Focus on bugs,
regressions, missing tests, and maintainability risks.
```

Creation checklist:

- Clarify the skill's purpose, trigger scenarios, and expected behavior.
- Choose a folder name that is short, lowercase, and hyphenated.
- Write a specific frontmatter `description` that includes when to use the skill.
- Keep `SKILL.md` concise and actionable.
- Put longer reference material in files next to `SKILL.md`, such as `reference.md` or `examples.md`, linked with relative links.
- Avoid time-sensitive claims unless the skill explicitly needs them.
- Do not include secrets in skill files.

## Updating A Skill

1. Locate the folder under `~/.hooman/skills`.
2. Read its current `SKILL.md` and any referenced files.
3. Make the smallest edit that satisfies the request.
4. Preserve frontmatter unless the user asked to rename or retarget the skill.
5. Keep supporting files in the same skill directory.

If changing the frontmatter `name`, consider whether the folder name should also change. Rename only when the user asks or the old folder name is clearly wrong.

## Installing By Copying Manually

Prefer the `skills` CLI for normal installs. To install from a local skill directory manually:

1. Verify the source directory contains `SKILL.md`.
2. Choose a destination folder under `~/.hooman/skills`.
3. Copy the skill directory into that destination.
4. If the destination already exists, ask before replacing or merge carefully after reading both copies.

For GitHub or web sources, prefer `skills add`. Fetch or clone manually only when the user asks or the CLI cannot handle the source. After retrieval, install by copying the actual skill directory into `~/.hooman/skills`.
