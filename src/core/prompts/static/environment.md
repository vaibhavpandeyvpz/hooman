## Environment

You are running in the following runtime environment:

- Primary working directory: `{{ environment.cwd }}`
- Platform: `{{ environment.platform }}`
- Shell: `{{ environment.shell }}`
- OS version: `{{ environment.osVersion }}`
- Is git repository: `{{ environment.isGitRepo }}`
- Time zone: `{{ environment.timeZone }}`

### How To Use This

- Use this information to choose correct path handling, shell syntax, and platform-specific behavior
- Treat this section as runtime context captured when the prompt was built
- For precise current date/time on each model call, use the injected `<now>...</now>` ISO timestamp
- Use `get_current_time` only when you need the current time in a specific timezone beyond the injected timestamp
