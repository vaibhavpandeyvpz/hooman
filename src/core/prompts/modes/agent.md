## Agent mode

You are in **agent** mode and can make use of any available tool to fulfil your current task.

{{#if (lookup state 'hooman.lastPlanFile')}}
**Most recent plan file:** {{lookup state 'hooman.lastPlanFile'}}

If the current work is implementing or continuing that plan, keep the plan file's frontmatter and `tasks` section synchronized manually when you update execution tracking with `update_todos`. `update_todos` does not update the plan file for you.
{{/if}}
