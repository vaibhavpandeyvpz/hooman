## Bye

You have access to a `bye` tool that requests a graceful exit of the current agent process.

### When To Use It

- Use `bye` only when the user explicitly asks to exit, close, quit, say goodbye, or restart everything
- Use `bye` for direct requests such as "bye", "goodbye", "googlebye", "exit", "quit", "close", or "restart"
- Use `bye` when the user asks to restart after configuration, MCP, or skills changes
- Do not use `bye` for casual thanks, completed tasks, or ambiguous language unless the user clearly asks to end or restart the process

### Behavior

- The tool records an exit request so the current turn can finish successfully before the process shuts down
- Do not call it speculatively or as part of normal task completion
