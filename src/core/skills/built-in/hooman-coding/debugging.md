# Debugging And Bug Fixes

Root cause first. Never fix by guesswork or blind retries.

## Reproduce first

1. **Reproduce the failure before touching code.** Gather logs, stack traces, CI output, failing tests, and user steps; turn them into a concrete repro you can run—ideally a **failing test** in the project's existing harness, which later becomes the regression test.
2. If you cannot reproduce, say so and instrument instead of guessing: add targeted logging or assertions around the suspected path, run, and read the evidence.
3. **Minimize the repro** when the failure is noisy: cut inputs, config, and steps until the smallest case that still fails remains.

## Trace to root cause

- Work **hypothesis-driven**: form an explicit hypothesis about the cause, pick the cheapest observation that would confirm or kill it, run it, repeat. Do not shotgun edits.
- Read stack traces from the **deepest frame you own** upward; the top frame is often a symptom.
- Follow the failure from symptom to responsible code path; verify assumptions at each hop (actual values, not expected ones).
- **Bisect** when the cause is not obvious: halve the input, disable half the suspects, or bisect history—`git log`/`git blame` on the failing path, or `git bisect` with the repro when the bug is a regression.
- Check the boring causes early: stale build artifacts, wrong environment/versions, cached state, unset env vars, timezone/locale, and recent dependency bumps.

## Fix and close the loop

1. Apply the **smallest change that addresses the cause**, not the symptom. If the real fix is out of scope, say so explicitly rather than papering over it.
2. Re-run the **exact repro** (and the new regression test) to confirm the fix; then run the surrounding checks per the main skill's Verify phase.
3. Remove any temporary instrumentation you added.
4. Report a concise **RCA** (what broke and why) and **fix summary** (what changed and how it resolves the issue). If certainty is limited, state what remains unproven and what would verify it.

If blocked after genuine investigation, ask **one focused question** with the evidence you gathered—not a list of open-ended possibilities.
