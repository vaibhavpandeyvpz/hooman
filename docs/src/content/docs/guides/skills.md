---
title: Skills
description: Built-in skills, ~/.hooman/skills, project-local .hooman/skills, and installing skills from /config.
---

Skills load from three sources, in addition to each other:

```text
~/.hooman/skills          # user-installed (global)
<cwd>/.hooman/skills      # project-local, when the folder exists
```

plus bundled built-in skills shipped with Hooman.

At runtime, Hooman uses the Strands `AgentSkills` plugin to load:

- bundled built-in skills (e.g. `hooman-coding`, `hooman-cybersec`, `hooman-design`, `hooman-config`, `hooman-mcp`, `hooman-channels`, `hooman-skills`)
- user-installed skills under `~/.hooman/skills`
- project-local skills under `<cwd>/.hooman/skills` when that directory exists

## Cybersecurity workflow

`hooman-cybersec` provides a model-agnostic, human-supervised workflow for cybersecurity tasks. It requires an authorization and risk gate, then routes work through separate offensive, defensive, application-security, standards, and reporting guidance.

For scoped reviews, Hooman also provides read-only `security-auditor` and `security-validator` subagents. The auditor identifies evidence-backed candidates; the validator independently challenges reachability, impact, duplicates, and remediation claims. Parent agents retain responsibility for any approved mutation or active validation.

The workflow does not provide an execution sandbox. Treat host execution and external interaction as operational actions subject to normal tool visibility and approval controls.

Each skills folder is treated as a parent directory of skill subdirectories, where every skill lives in its own folder containing a `SKILL.md`.

When a session starts, the plugin injects available skill metadata into the system prompt and exposes the `skills` tool so the model can activate a skill and load its full instructions on demand.

## Project-local skills

Drop a skill under the working directory's `.hooman/skills/` to share it with anyone who runs Hooman in that project — no install into the home catalog required. Project-local skills sit alongside the global catalog and built-ins; they are not managed by the `/config` install/remove flow (that targets `~/.hooman/skills`).

## Managing skills

The [`/config`](/hooman/guides/cli/#config) workflow (and the VS Code **Skills** panel) can:

- search the public skills catalog
- install a skill from a source string, repo, URL, or local path into `~/.hooman/skills`
- refresh installed skills
- remove installed skills with confirmation

## Bundled prompt harness

Independent of skills, Hooman ships toggleable harness prompt sections (`prompts.behaviour`, `prompts.communication`, `prompts.execution`, `prompts.guardrails` in `config.json`). Coding-specific guidance ships as the built-in `hooman-coding` skill rather than a hardcoded prompt section, so it can be updated or disabled like any other skill.
