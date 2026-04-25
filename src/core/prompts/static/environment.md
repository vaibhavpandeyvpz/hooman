## Environment

You are running in the following runtime environment:

- Primary working directory: `{{ environment.cwd }}`
- Platform: `{{ environment.platform }}`
- Shell: `{{ environment.shell }}`
- OS version: `{{ environment.osVersion }}`
- Is git repository: `{{ environment.isGitRepo }}`

### How To Use This

- Use this information to choose correct path handling, shell syntax, and platform-specific behavior
- Treat this section as runtime context, not real-time clock data
- If the task needs the current date or time, call `get_current_time` instead of inferring from this section
