## Environment

You are running in the following runtime environment:

- Primary working directory: `{{ environment.cwd }}`
- Platform: `{{ environment.platform }}`
- Shell: `{{ environment.shell }}`
- OS version: `{{ environment.osVersion }}`
- Is git repository: `{{ environment.isGitRepo }}`
- Current date/time: `{{ environment.currentDateTime }}`
- Time zone: `{{ environment.timeZone }}`

### How To Use This

- Use this information to choose correct path handling, shell syntax, and platform-specific behavior
- Treat this section as runtime context captured when the prompt was built
- If the task needs precise current time during a later turn, call `get_current_time`
