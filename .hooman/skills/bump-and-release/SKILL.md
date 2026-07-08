---
name: bump-and-release
description: Bump and release the Hooman repository by reviewing changes since the latest version tag, choosing a patch or minor bump, updating root and VS Code extension versions together, verifying clean builds, updating the VS Code changelog, formatting, committing, pushing, and tagging. Use when the user asks to prepare or perform a release for this repo.
---

# Bump And Release

Use this skill when releasing the Hooman repository.

## Scope

This workflow applies to the main repository and the VS Code extension package under `src/vscode/`.

Versioning rules:

- Never bump major automatically.
- If changes since the latest tag are fixes only, bump `patch`.
- If any new feature was added, bump `minor`.
- If the changes look like a major-version candidate, stop before bumping and ask the user how they want to proceed.
- Root and VS Code extension versions must always match.

## Required workflow

Follow these steps in order.

1. Identify the current release baseline.
   - Read the root `package.json` version.
   - Read `src/vscode/package.json` version.
   - Confirm they match before proceeding.
   - Find the latest git tag, expected in the form `v<version>`.

2. Inspect what changed since the latest tag.
   - Review `git log` from the latest tag to `HEAD`.
   - Review `git diff` from the latest tag to `HEAD`.
   - Understand the actual changes, not just commit messages.
   - Classify the release:
     - `patch` for fixes, chores, docs, maintenance, or other non-feature changes.
     - `minor` if any user-visible or developer-facing feature was added.
     - If the changes include breaking behavior, API removals, or other major-bump candidates, stop and ask the user instead of continuing.

3. Verify the working tree and release readiness.
   - Surface any unexpected uncommitted changes before making release edits.
   - Make sure the repo is in a state suitable for a release bump.

4. Build and verify before changing versions.
   - Run root build with:
     - `npm run build`
   - Run VS Code extension build from `src/vscode/` with:
     - `npm run compile`
   - Treat warnings, build failures, or suspicious output as blockers.
   - Do not continue if either build has warnings or issues; fix them first or report the blocker.

5. Bump versions using npm.
   - Use `npm version <patch|minor> --no-git-tag-version` at the root to update the root package version and root `package-lock.json` together.
   - Capture the resulting new version.
   - In `src/vscode/`, use `npm version <new-version> --no-git-tag-version` so `src/vscode/package.json` and `src/vscode/package-lock.json` are updated together.
   - Confirm the root package version and VS Code extension version exactly match after both commands.
   - Use npm-based versioning rather than manual JSON edits where practical.
   - Do not create a major bump.

6. Update release notes.
   - Update `src/vscode/CHANGELOG.md` with the changes included in this release.
   - Write concise, accurate notes based on the actual diff since the previous tag.
   - Do not invent changes.

7. Format the repository.
   - Run:
     - `npx prettier . --write`

8. Re-verify after edits.
   - Re-run the same required builds:
     - root: `npm run build`
     - VS Code extension: `npm run compile` from `src/vscode/`
   - Confirm both complete cleanly, with no warnings or issues.

9. Commit and publish the release.
   - Stage everything with:
     - `git add -A`
   - Commit with:
     - `git commit -m "Bump to <version>"`
   - Push the branch.
   - Create the version tag:
     - `git tag v<version>`
   - Push the tag:
     - `git push origin v<version>`

## Decision rules

When deciding between patch and minor, prefer evidence from the diff:

- Bump `minor` for newly added commands, options, workflows, MCP capabilities, UI features, extension features, or other net-new behavior.
- Bump `patch` for bug fixes, refactors, docs-only changes, internal cleanup, dependency maintenance, formatting, or behavior corrections without new features.
- If uncertain whether something is breaking enough to justify a major release, stop and ask the user instead of guessing.

## Operating guidance

- Read relevant files before editing them.
- Keep root and `src/vscode` versions synchronized, including any corresponding `package-lock.json` files.
- Verify command output instead of assuming success.
- Summarize the detected changes and why the chosen bump type is correct.
- If there is no prior tag, explain that clearly and ask the user how they want to establish the initial release baseline.
- If pushing, tagging, or committing fails, stop and report the exact blocker.

## Minimum commands to expect

Use the exact commands below where applicable:

```bash
npm run build
cd src/vscode && npm run compile
npm version <patch|minor> --no-git-tag-version
cd src/vscode && npm version <new-version> --no-git-tag-version
npx prettier . --write
git add -A
git commit -m "Bump to <version>"
git push
git tag v<version>
git push origin v<version>
```

For versioning, use npm version commands so both `package.json` and `package-lock.json` are updated in root and `src/vscode/`, then confirm both package versions match exactly.
