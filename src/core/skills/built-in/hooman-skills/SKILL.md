---
name: hooman-skills
description: Manage Hooman skills under ~/.hooman/skills. Use when the user asks to list, search, install, add, create, author, update, inspect, or remove Hooman skills or SKILL.md files. Not for activating or using a skill in the current task, and not for Hooman config or MCP server changes (use hooman-config or hooman-mcp).
---

# Hooman Skills

Use this skill when the user asks you to inspect, install, remove, create, or change Hooman's skills.

## Source Of Truth

- Hooman user-installed skills live under `~/.hooman/skills`; each installed skill is a directory directly under it containing a `SKILL.md` file (for example `~/.hooman/skills/code-review/SKILL.md`).
- Built-in skills shipped with Hooman are separate from user-installed skills. Do not edit bundled skill files when the user means their installed skills.

## Reference File

Read `authoring.md` (next to this SKILL.md) before creating a new skill, editing a `SKILL.md`, or installing by manual copy. It covers frontmatter shape, naming rules, the creation checklist, update steps, and manual install steps.

## Operating Rules

1. Use the `skills` CLI for catalog search, installs, listing, and removal when the user asks for those operations.
2. Run every `skills` CLI command with working directory `~/.hooman` so the OpenClaw layout maps to `~/.hooman/skills`.
3. Hooman discovers installed skills by scanning direct child directories under `~/.hooman/skills` for `SKILL.md`.
4. Preserve unrelated skill folders and files; treat files inside a skill directory as user data and read before overwriting.
5. Never delete a skill folder unless the user explicitly asks to remove that skill.
6. For custom local authoring or edits, create/edit files directly under `~/.hooman/skills/<folder>`.
7. Any skill install, removal, creation, or edit requires restarting the running Hooman agent/session before the runtime skill inventory changes.

## Exact CLI Commands

Run from `~/.hooman` (`mkdir -p ~/.hooman && cd ~/.hooman`), or set the shell tool's working-directory option to `~/.hooman`.

List installed skills:

```bash
npx --yes skills@latest list --json -a openclaw
```

Search the public skills catalog:

```bash
npx --yes skills@latest find "query"
```

Add/install a skill into Hooman:

```bash
npx --yes skills@latest add "<source>" -y -a openclaw --copy
```

Remove a skill:

```bash
npx --yes skills@latest remove "<skill-or-folder>" -y
```

Command notes:

- `<source>` can be a package source accepted by the skills CLI, such as `owner/repo`, a GitHub URL, or a local path.
- Use `--copy` for Hooman installs so skill files are copied into `~/.hooman/skills` instead of relying on symlinks.
- If `list --json` fails or output is not useful, list skills by inspecting `~/.hooman/skills` directly: read each direct child directory's `SKILL.md` frontmatter and report `name`, `description`, folder name, and path. Ignore directories without `SKILL.md`.
- After installing or removing, verify the result by checking `~/.hooman/skills/<folder>/SKILL.md`.

## Common Mistakes

- Do not create a single `~/.hooman/skills/SKILL.md`; each skill needs its own folder.
- Do not put installed Hooman skills under another application's skills directory; they belong under `~/.hooman/skills`.
- Do not edit bundled Hooman skills when the user asked to install or update a personal skill.
- Do not assume a catalog result is installed. A skill is installed only when its folder exists under `~/.hooman/skills` with `SKILL.md`.
