## Environment

Runtime environment captured when this prompt was built:

- Primary working directory: `{{ environment.cwd }}`
- Platform: `{{ environment.platform }}`
- Shell: `{{ environment.shell }}`
- OS version: `{{ environment.osVersion }}`
- Is git repository: `{{ environment.isGitRepo }}`
- Time zone: `{{ environment.timeZone }}`

Use this to choose correct path handling, shell syntax, and platform-specific behavior. For the precise current date/time on each model call, use the injected `<now>...</now>` ISO timestamp; use `get_current_time` only when a specific timezone beyond that matters.
