## Environment

Runtime environment captured when this prompt was built:

- Primary working directory: `{{ environment.cwd }}`
- Platform: `{{ environment.platform }}`
- Shell: `{{ environment.shell }}`
- OS version: `{{ environment.osVersion }}`
- Is git repository: `{{ environment.isGitRepo }}`
- Time zone: `{{ environment.timeZone }}`
- Date & time at session start: `{{ environment.datetime }}`

Use this to choose correct path handling, shell syntax, and platform-specific behavior. The date & time above is from session start and goes stale in long sessions; use `get_current_time` whenever the precise current time matters.
