---
title: Development
description: Repository layout, build/typecheck commands, and the release workflow.
---

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/cli.ts` | CLI entrypoint (Commander + Ink). Compiles to `dist/cli.js`, exposed as the `hooman` bin. |
| `src/index.ts` | Public library API exported by the npm package. |
| `src/core/` | Core configuration, memory, state, context, and skills registry. |
| `src/core/agent/` | Agent bootstrap and invocation loop. |
| `src/core/tools/` | Built-in tool definitions (filesystem, shell, web_search, fetch, etc.). |
| `src/core/modes/` | Session mode logic (`agent`, `ask`, `plan`). |
| `src/core/mcp/` | MCP client configuration, connection, OAuth auth, and tool bridging. |
| `src/core/approvals/` | Tool-call approval system for `exec`, `chat`, and `daemon`. |
| `src/core/subagents/` | Subagent orchestration utilities. |
| `src/chat/` | Interactive `chat` TUI (Ink/React components). |
| `src/configure/` | Ink-based configuration workflow. |
| `src/exec/` | One-shot `exec` command approval handling. |
| `src/daemon/` | MCP channel-driven `daemon` command. |
| `src/acp/` | Agent Client Protocol (ACP) stdio server. |
| `src/vscode/` | Self-contained [VS Code extension](/hooman/guides/vscode/) sub-package — own `package.json`/`tsconfig.json`, excluded from the root build. |
| `docs/` | This site — an Astro + Starlight sub-package, deployed to GitHub Pages. |
| `scripts/copy-bundled-assets.mjs` | Post-build step that copies Markdown skill/prompt assets into `dist/`. |

## Build and run

Install dependencies:

```bash
npm install
```

Run the CLI in development (uses `tsx`):

```bash
npm run dev -- --help
npm run dev -- exec "your prompt"
npm run dev -- chat
```

Build for release:

```bash
npm run build   # tsc + copy bundled assets to dist/
npm run start   # node dist/cli.js
```

Other useful scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run clean       # rm -rf dist
npm link            # link `hooman` CLI locally
```

After making any code change, run both verification steps:

```bash
npm run typecheck
npm run build
```

There is no test framework configured in this repository — verification is build-based. Smoke-test the built CLI with `node dist/cli.js --help`.

## This site

The `docs/` sub-package is Astro + Starlight, isolated from the root build the same way `src/vscode/` is.

```bash
cd docs
npm install
npm run dev     # local preview
npm run build   # -> docs/dist/
```

It's deployed to GitHub Pages by `.github/workflows/publish-pages.yml` on pushes to `main` that touch `docs/**`.

## Release workflow

Publishing to npm is handled by `.github/workflows/publish-npm.yml`:

- Triggers on pushes to `main`, tags matching `v*`, and manual dispatch.
- Runs `npm ci` and `npm run build`.
- Publishes to npm with provenance only when the ref is a `refs/tags/v*` tag.

Bump the version in `package.json` and push a matching Git tag to release. The VS Code extension is versioned and released in lockstep via `.github/workflows/publish-vscode.yml`.
