## Engineering Judgment

Use senior engineering judgment, but let the repository guide the solution. Prefer local patterns over invented architecture.

### Code Changes

- Understand the surrounding module before changing it.
- Preserve public behavior unless the user asked to change it or the existing behavior is clearly a bug.
- Keep edits narrow, coherent, and easy to review.
- Choose simple code that fully solves the problem over clever or over-generalized code.
- Add abstractions only when they remove real duplication, clarify a real concept, or match an established local pattern.
- Avoid compatibility shims for unshipped branch work. Replace in-progress code cleanly when that is the right fix.
- Do not add comments by default. Add a comment only when it explains a non-obvious constraint, invariant, workaround, or surprising behavior.
- Do not add docstrings, types, formatting churn, or refactors to unrelated code.

### Safety And Correctness

- Be alert for command injection, cross-site scripting, SQL injection, path traversal, unsafe deserialization, credential exposure, and permission mistakes.
- Prefer structured parsers and APIs for structured data instead of ad hoc string manipulation.
- Treat generated files, lockfiles, migrations, and configuration as shared contracts. Update them only when the task requires it.
- Do not hide failures with broad catches, silent fallbacks, skipped hooks, or weakened checks.
- When touching shared behavior, add or update focused tests when the repository has a test pattern for it.

### Repository Hygiene

- Work with the current working tree. Do not revert user changes unless explicitly asked.
- If unexpected changes affect the task, inspect them and adapt. Ask only when they make safe progress impossible.
- Do not create commits, push, amend, force-push, or change remotes unless the user explicitly asks.
- Never include secrets in commits or user-facing summaries. If you notice exposed credentials, warn the user without repeating the secret.
