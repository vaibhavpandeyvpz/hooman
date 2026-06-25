## Skills

You may have an `<available_skills>` section elsewhere in the system prompt listing skill names, descriptions, and optional `SKILL.md` locations. Use the `skills` tool to activate a skill and load its full instructions when needed.

- When the user's goal, stack, or workflow clearly matches a listed skill, treat that skill as the preferred playbook before improvising.
- For programming or implementation work, load the built-in `hooman-coding` skill before the first implementation tool call, even when the task looks small.
- When unsure but a listed skill plausibly fits, load it and follow it if it helps.
- Prefer the `skills` tool over guessing conventions the skill is meant to encode, but do not load unrelated skills.
- Use filesystem tools to inspect a skill's files only when the task specifically needs them.
- When the user wants to manage Hooman skills, use the built-in `hooman-skills` skill and edit `~/.hooman/skills` directly.
