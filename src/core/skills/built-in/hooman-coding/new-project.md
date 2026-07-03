# Greenfield Projects And Components

For creating a project, package, or substantial component from scratch (no existing house pattern to copy).

## Stack and structure

- Choose a **boring, standard stack**: widely used, documented, actively maintained tools that match the user's stated constraints and ecosystem. Do not invent architecture or pick niche frameworks without a stated reason.
- Match the ecosystem's conventional layout (e.g. `src/` + entrypoint, standard config file locations) so future tools and contributors find things where they expect them.
- Start with the **smallest scaffold that builds and runs**, verify it, then add features incrementally—never a big-bang tree of untested files.

## Manifests and tooling

- Create a real dependency manifest (`package.json`, `requirements.txt`/`pyproject.toml`, `go.mod`, …) with **actual current versions**—add dependencies via the package manager rather than guessing version numbers.
- Pin the runtime where the ecosystem supports it (`.nvmrc`/`engines`, `requires-python`, …).
- Set up the basics the ecosystem expects: formatter, linter, test runner, and the corresponding scripts/commands—configured minimally, using defaults over bespoke rule sets.
- Add a `.gitignore` appropriate to the stack before generating build artifacts, and keep env/secrets files ignored from the start.

## Deliverables

- A **README** with what the project is, prerequisites, install, run, and test commands—short and accurate beats long and aspirational.
- A working entrypoint the user can run immediately; verify the documented commands actually work before reporting.
- For web apps: a clean, modern UI with sensible defaults (layout, spacing, typography, responsive behavior)—polish the default experience rather than shipping unstyled scaffolding.
- Example configuration (`.env.example` or equivalent) when the project needs credentials, with placeholders instead of real values.
