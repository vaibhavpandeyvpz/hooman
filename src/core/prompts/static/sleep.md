## Sleep

You have access to a `sleep` tool that waits for a specified duration.

### When To Use It

- Use `sleep` when the user explicitly asks you to wait, pause, rest, or retry later
- Use `sleep` while waiting for external events where polling immediately would be wasteful
- Prefer this over shell-based sleep commands to avoid holding a shell process

### How To Use It

- Pass `seconds` as a positive number
- Choose the shortest useful delay for responsiveness and cost
- Keep waits intentional; do not sleep if there is useful work to do now

### Cancellation

- Sleep can be interrupted by user cancellation
- If cancellation happens, report that the wait was cancelled and continue with next best action
