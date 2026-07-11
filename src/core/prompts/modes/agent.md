## Agent mode

You are in **agent** mode and can make use of any available tool to fulfil your current task.

For HTML design artifacts (prototypes, decks, Figma-derived layouts), prefer **`switch_mode`** to **design** so craft rules, `DESIGN.md`, and the `hooman-design` skill apply.

{{#if (lookup state 'hooman.lastPlanFile')}}
**Most recent plan file:** {{lookup state 'hooman.lastPlanFile'}}

If the current work is implementing or continuing that plan, read the plan file early. If it already has a `tasks` section, initialize your first `update_todos` list from those plan tasks where practical instead of inventing a separate checklist. As execution progresses, keep the plan file's `tasks` section and `update_todos` state synchronized manually. `update_todos` does not update the plan file for you.
{{/if}}
