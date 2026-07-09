# Hooman — AI agent toolkit

Hooman is a local-first AI agent toolkit written in TypeScript. It ships as a Node.js CLI (`hooman`) and library (`hoomanjs`), built around the Strands Agents SDK and Ink.

- Package: `hoomanjs`
- Runtime: Node.js `>= 24` (`.nvmrc` = `24`)
- Module system: ES modules (`"type": "module"`)
- Root build output: `dist/`

## Project overview

Main surfaces:

- `hooman` / `hooman chat` — interactive Ink chat UI
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
  - `tools/` — built-in tools (filesystem, shell, grep, fetch, web search, time, todo, etc.)
  - `models/` — provider integrations
  - `mcp/` — MCP config, transports, OAuth, tool bridging
  - `modes/` — `agent`, `ask`, and `plan` mode logic
  - `prompts/` — system and static prompt assets
  - `skills/` — skills registry and built-in skills
  - `sessions/`, `state/`, `memory/`, `approvals/`, `utils/` — session/state helpers and supporting infrastructure
- `src/chat/` — Ink chat UI
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

- `.github/workflows/publish-npm.yml` — builds on pushes to `main`; publishes to npm on `v*` tags
- `.github/workflows/publish-pages.yml` — builds and deploys `docs/` to GitHub Pages
- `.github/workflows/publish-vscode.yml` — packages VS Code extension on `main`; publishes on `v*` tags

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

## Runtime and operational notes

- `AGENTS.md` files are discovered by walking from the git root down to the current working directory. Keep this file concise and high-signal because it is prompt input.
- Project-local runtime overlays live under `.hooman/` (`config.json`, `mcp.json`) and are separate from `AGENTS.md` discovery.
- `src/vscode/` is intentionally isolated from the root build/typecheck; do not assume root commands validate it.
- `stdout` discipline matters:
  - `acp` uses stdout for JSON-RPC
  - `exec` uses stdout for agent output
  - `chat` owns the Ink frame
    Avoid stray `console.*` output in shared/runtime paths; see `src/core/utils/logging.ts` and how it is applied in `src/cli.ts`.
- `reference/` is for reading only unless the task explicitly targets vendored reference material.

## Security and release notes

- Do not commit secrets. The repo contains configuration paths that may reference local credentials, but secrets belong in user-local config under `~/.hooman/` or environment variables, not source files.
- Publishing is tag-driven:
  - npm package publishes from `v*` tags via `.github/workflows/publish-npm.yml`
  - VS Code extension publishes from `v*` tags via `.github/workflows/publish-vscode.yml`
- Docs deploy from `main` when `docs/**` changes via `.github/workflows/publish-pages.yml`

## Practical guidance for agents

- After making any code changes, you MUST rebuild the affected package(s) before considering the task done:
  - Root package (`src/**` outside `src/vscode/` and `docs/`): run `npm run build` in the project root. The VS Code extension runs the compiled `dist/cli.js` (via `hooman.acp.command`), so `src/` edits are not picked up until `dist/` is rebuilt.
  - VS Code extension (`src/vscode/**`): run `npm run compile` from `src/vscode/`.
- For normal root-package code changes, verify with `npm run typecheck` and `npm run build`.
- If you touch `src/vscode/`, verify from `src/vscode/` separately.
- If you touch `docs/`, verify from `docs/` separately.
- Do not edit `reference/` during ordinary feature work.
- Keep AGENTS guidance factual and derived from the repository, not assumptions.
