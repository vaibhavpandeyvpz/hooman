---
title: Skills
description: Built-in skills, ~/.hooman/skills, and installing skills from /config.
---

Skills are installed under:

```text
~/.hooman/skills
```

At runtime, Hooman uses the Strands `AgentSkills` plugin to load:

- bundled built-in skills shipped with Hooman (e.g. `hooman-coding`, `hooman-config`, `hooman-mcp`, `hooman-channels`, `hooman-skills`)
- user-installed skills under `~/.hooman/skills`

The local skills folder is treated as a parent directory of skill subdirectories, where each installed skill lives in its own folder containing a `SKILL.md`.

When a session starts, the plugin injects available skill metadata into the system prompt and exposes the `skills` tool so the model can activate a skill and load its full instructions on demand.

## Managing skills

The [`/config`](/hooman/guides/cli/#config) workflow can:

- search the public skills catalog
- install a skill from a source string, repo, URL, or local path
- refresh installed skills
- remove installed skills with confirmation

## Bundled prompt harness

Independent of skills, Hooman ships toggleable harness prompt sections (`prompts.behaviour`, `prompts.communication`, `prompts.execution`, `prompts.guardrails` in `config.json`). Coding-specific guidance ships as the built-in `hooman-coding` skill rather than a hardcoded prompt section, so it can be updated or disabled like any other skill.
