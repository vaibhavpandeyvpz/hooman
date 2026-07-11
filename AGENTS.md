# Hooman — AI agent toolkit

Hooman is a local-first AI agent toolkit written in TypeScript. It ships as a Node.js CLI (`hooman`) and library (`hoomanjs`), built around the Strands Agents SDK and Ink.

- Package: `hoomanjs`
- Runtime: Node.js `>= 24` (`.nvmrc` = `24`)
- Module system: ES modules (`"type": "module"`)
- Root build output: `dist/`

## Project overview

Main surfaces:

- `hooman` / `hooman chat` — interactive Ink chat UI (no args runs setup when `~/.hooman/config.json` is missing)
- `hooman setup` — first-run wizard (inference + search → write `config.json`)
- `hooman exec "prompt"` — one-shot agent run
- `hooman daemon` — channel-driven MCP automation
- `hooman acp` — Agent Client Protocol server over stdio
- `src/vscode/` — separate VS Code extension package backed by `hooman acp`
- `docs/` — separate Astro/Starlight documentation site

## Repository layout

- `src/cli.ts` — CLI entrypoint; compiled to `dist/cli.js` and exposed as the `hooman` bin
- `src/index.ts` — flat public library API
- `src/core/` — shared runtime code
  - `agent/` — bootstrap and invocation loop
  - `tools/` — built-in tools (filesystem, grep, fetch, web search, time, todo, etc.)
  - `shell/` — shell tool and background job manager (`shell` / `shell_output` / `shell_stop`)
  - `models/` — provider integrations
  - `mcp/` — MCP config, transports, OAuth, tool bridging
  - `modes/` — `agent`, `ask`, `plan`, and `design` mode logic
  - `prompts/` — system and static prompt assets
  - `skills/` — skills registry and built-in skills (includes `hooman-design`)
  - `sessions/`, `state/`, `memory/`, `approvals/`, `utils/` — session/state helpers and supporting infrastructure (includes `onboarding-config.ts`, `models-prefetch.ts`, `search-probe.ts`, design delivery export under `utils/export-design.ts` / `export-figma.ts` / `export-sketch.ts`)
- `src/chat/` — Ink chat UI
- `src/onboarding/` — Ink first-run setup UI (`hooman setup`)
- `src/configure/` — configuration UI used from chat
- `src/exec/` — exec-mode approvals and questions
- `src/daemon/` — daemon command support
- `src/acp/` — ACP server implementation
- `src/vscode/` — self-contained VS Code extension package; excluded from the root TypeScript build
- `docs/` — self-contained docs package; excluded from the root TypeScript build
- `scripts/copy-bundled-assets.mjs` — copies prompt and skill Markdown assets into `dist/`
- `reference/` — vendored reference code; do not edit for normal feature work

## Key configuration files

Root package:

- `package.json` — npm package metadata, root scripts, runtime/dependency definitions
- `package-lock.json` — npm lockfile; use npm, not pnpm/yarn/bun for repo work
- `tsconfig.json` — strict TypeScript config for the root package; excludes `src/vscode/**`
- `.nvmrc` — Node 24

Sub-packages:

- `src/vscode/package.json` — VS Code extension package and scripts
- `docs/package.json` — Astro docs package and scripts

CI/workflows:

- `.github/workflows/ci.yml` — typecheck, Prettier check, root build, and VS Code compile on pushes to `main` (and manual dispatch)
- `.github/workflows/docs.yml` — builds and deploys `docs/` to GitHub Pages on pushes to `main` that touch `docs/**`
- `.github/workflows/cd.yml` — on `v*` tags: publish npm, VS Code Marketplace, and CLI release bundles / GitHub release in parallel

## Build and run commands

Root package:

```bash
npm install
npm run dev -- --help
npm run dev -- exec "your prompt"
npm run dev -- chat
npm run typecheck
npm run build
npm run start
node dist/cli.js --help
```

Notes:

- `npm run build` runs `tsc -p tsconfig.json` and then `node scripts/copy-bundled-assets.mjs`
- `npm run start` runs the built CLI from `dist/cli.js`
- `npm link` can be used to link the `hooman` CLI locally

VS Code extension (`src/vscode/`):

```bash
cd src/vscode
npm install
npm run compile
npm run typecheck
npm run package
```

Docs site (`docs/`):

```bash
cd docs
npm install
npm run dev
npm run typecheck
npm run build
```

## Testing and verification

There is no root test framework configured.

Verified from the repository:

- root `package.json` has no `test` script
- root verification is build-based

Default verification for root code changes:

```bash
npm run typecheck
npm run build
node dist/cli.js --help
```

For `src/vscode/` changes, run its local checks from that directory:

```bash
npm run typecheck
npm run compile
```

For `docs/` changes, run from `docs/`:

```bash
npm run typecheck
npm run build
```

## Code style and implementation conventions

- TypeScript is strict (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noUncheckedIndexedAccess` are enabled).
- The root package uses `module: "NodeNext"` / `moduleResolution: "NodeNext"`.
- Internal TypeScript imports use `.js` extensions in source files.
- JSX is enabled with `react-jsx`; Ink UI code uses React.
- Follow existing naming and file layout patterns; many modules use kebab-case filenames.
- Prompt and skill Markdown files under `src/core/prompts/` and `src/core/skills/built-in/` are runtime assets and must stay in sync with code that loads them.
- Prefer editing existing modules over creating parallel abstractions unless the repository already has a clear sibling pattern.

## UI design guidelines

Apply these consistently across CLI Ink (`src/chat/`, `src/onboarding/`, `src/configure/`), the VS Code extension webview and host chrome (`src/vscode/`), and docs brand tokens (`docs/`).

Brand palette (do not invent ad-hoc accents):

| Role      | Hex       |
| --------- | --------- |
| Primary   | `#0091cd` |
| Secondary | `#56a0d3` |
| Warning   | `#ecb731` |
| Error     | `#ee4c58` |
| Success   | `#8ec06c` |
| Info      | `#c4dff6` |
| Muted     | `#9ba5a8` |

Token sources of truth:

- CLI Ink: `src/core/theme.ts` (`theme.primary`, `theme.secondary`, …) — import and use these instead of named ANSI colors like `"cyan"` / `"red"`
- VS Code webview: `src/vscode/webview/index.css` (`@theme` + `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-ghost`)
- Docs: `docs/src/styles/tokens.css`

Component rules:

- Prefer **compact** controls (small padding, `text-[11px]`–`text-xs` for chrome actions)
- Prefer **small rounded** corners (`rounded-md` / `0.375rem`); avoid pill buttons (`rounded-full`) for actions — reserve full rounding for dots, progress bars, and decorative blurs
- Prefer **sentence case** for user-facing labels and commands (`Keep all`, `New chat`, `Open settings…`), not Title Case
- Keep primary vs secondary button roles consistent: solid primary for the main affirmative action, secondary/outline for supporting actions, ghost for low-emphasis text actions
- In settings/MCP/skills toolbars, keep adjacent inputs and buttons the same height (`h-8` / shared control classes in `SettingsEditorView`)
- Open `instructions.md` in VS Code’s default Markdown editor (not a custom webview editor)
- When adding UI, reuse existing button/token classes rather than hardcoding hex or one-off Tailwind color utilities (`text-cyan-400`, `bg-yellow-500`, etc.)
- Surfaces (backgrounds, borders, fonts) in the VS Code webview may still follow host `--vscode-*` chrome; semantic accents (buttons, success/error/warning/info, muted, links) should use the brand tokens above
- Use muted (`#9ba5a8` / `theme.muted` / `text-muted`) for secondary labels, hints, chrome text, and other low-emphasis surface elements — not host gray or ANSI `"gray"`

## Runtime and operational notes

- `AGENTS.md` files are discovered by walking from the git root down to the current working directory. Keep this file concise and high-signal because it is prompt input.
- Project-local runtime overlays live under `.hooman/` (`config.json`, `mcp.json`) and are separate from `AGENTS.md` discovery.
- `DESIGN.md` is discovered the same way as `AGENTS.md` (git root → cwd walk) and injected into the system prompt when present.
- Design mode writes HTML artifacts under `.hooman/design/<slug>/` (entry `index.html`). Strict workflow: intake (brand/fresh/reference) → clarify → shell (5 best-fit + other) → theme (`DESIGN.md` or 5 directions + other) → build → `preview_design` (keep open) → visual QA (`export_design` images + `launch_subagent` `kind: "design-review"`) → human review → ask export format → delivery export → then `stop_design_preview`. Delivery formats: `pdf` / `images-to-pdf` / PowerPoint-ready `pptx` / Figma-ready `figma` / `figma-deck` / Sketch-ready `sketch` (see `hooman-design` skill for export details). Needs `npx playwright install chromium` once. Preview is auto-approved under `.hooman/design/`; read review shots with `binary: true`.
- `src/vscode/` is intentionally isolated from the root build/typecheck; do not assume root commands validate it.
- `stdout` discipline matters:
  - `acp` uses stdout for JSON-RPC
  - `exec` uses stdout for agent output
  - `chat` owns the Ink frame
    Avoid stray `console.*` output in shared/runtime paths; see `src/core/utils/logging.ts` and how it is applied in `src/cli.ts`.
- `reference/` is for reading only unless the task explicitly targets vendored reference material.

## Security and release notes

- Do not commit secrets. The repo contains configuration paths that may reference local credentials, but secrets belong in user-local config under `~/.hooman/` or environment variables, not source files.
- Publishing is tag-driven (only docs and CI run on push to `main`):
  - npm, VS Code Marketplace, and CLI release bundles publish from `v*` tags via `.github/workflows/cd.yml`
- Docs deploy from `main` when `docs/**` changes via `.github/workflows/docs.yml`

## Practical guidance for agents

- After making any code changes, you MUST rebuild the affected package(s) before considering the task done:
  - Root package (`src/**` outside `src/vscode/` and `docs/`): run `npm run build` in the project root. The VS Code extension runs the compiled `dist/cli.js` (via `hooman.acp.command`), so `src/` edits are not picked up until `dist/` is rebuilt.
  - VS Code extension (`src/vscode/**`): run `npm run compile` from `src/vscode/`.
- For normal root-package code changes, verify with `npm run typecheck` and `npm run build`.
- If you touch `src/vscode/`, verify from `src/vscode/` separately.
- If you touch `docs/`, verify from `docs/` separately.
- Do not edit `reference/` during ordinary feature work.
- Keep AGENTS guidance factual and derived from the repository, not assumptions.
