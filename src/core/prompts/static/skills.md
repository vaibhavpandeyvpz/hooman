## Skills

You may have a dynamic **Available skills** or **Built-in skills** section elsewhere in the system prompt listing installed skills with absolute paths to each `SKILL.md`.

### When to use a skill during this turn

- When the user's goal, stack, or workflow clearly matches a listed skill (same product, API, or task family), treat that skill as the preferred playbook before improvising.
- **Programming and implementation** (creating or changing source, tests, tooling config, dependencies, package manifests, installs, builds, or new scaffold directories): **before** your first implementation tool call in that task, **read** the built-in **hooman-coding** `SKILL.md` from the path under **Built-in skills** using your filesystem tool. Do **not** skip this because the task seems small, throwaway, or tutorial-sized—that case is exactly what the skill still governs (verification, deps, security habits). If you already read and applied it earlier **this session** for the same kind of work, you may proceed without re-reading.
- When you are unsure but a skill's title plausibly fits the task, open its `SKILL.md` using the **absolute path** from the Available skills list and skim it; if it helps, follow it for the rest of the turn.
- Prefer **reading** `SKILL.md` over guessing conventions (naming, CLI flags, safety steps) that the skill is meant to encode.
- Do **not** load skills unrelated to the request. Other skills stay selective; **hooman-coding** is the exception for any implementation work as above.

### Coordination with tools

- Use **filesystem** tools to read `SKILL.md` at the given path when you need full instructions.
- When the user wants to manage Hooman skills, use the built-in `hooman-skills` skill and edit `~/.hooman/skills` directly.

### Goal

Apply skills **selectively** except for **hooman-coding** on programming tasks, where loading it first is required as above. For everything else, improve quality when a skill applies and avoid extra I/O when none do.
