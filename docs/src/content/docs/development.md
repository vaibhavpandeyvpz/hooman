---
title: Development
description: Repository layout, build/typecheck commands, and the release workflow.
---

## Repository layout

| Path                              | Purpose                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/cli.ts`                      | CLI entrypoint (Commander + Ink). Compiles to `dist/cli.js`, exposed as the `hooman` bin.                                                  |
| `src/index.ts`                    | Public library API exported by the npm package.                                                                                            |
| `src/core/`                       | Core configuration, memory, state, context, and skills registry.                                                                           |
| `src/core/agent/`                 | Agent bootstrap and invocation loop.                                                                                                       |
| `src/core/tools/`                 | Built-in tool definitions (filesystem, web_search, fetch, etc.).                                                                           |
| `src/core/shell/`                 | Shell tool plus background job manager (`shell` / `shell_output` / `shell_stop`).                                                          |
| `src/core/modes/`                 | Session mode logic (`agent`, `ask`, `plan`).                                                                                               |
| `src/core/mcp/`                   | MCP client configuration, connection, OAuth auth, and tool bridging.                                                                       |
| `src/core/approvals/`             | Tool-call approval system for `exec`, `chat`, and `daemon`.                                                                                |
| `src/core/subagents/`             | Subagent orchestration utilities.                                                                                                          |
| `src/chat/`                       | Interactive `chat` TUI (Ink/React components).                                                                                             |
| `src/configure/`                  | Ink-based configuration workflow.                                                                                                          |
| `src/exec/`                       | One-shot `exec` command approval handling.                                                                                                 |
| `src/daemon/`                     | MCP channel-driven `daemon` command.                                                                                                       |
| `src/acp/`                        | Agent Client Protocol (ACP) stdio server.                                                                                                  |
| `src/vscode/`                     | Self-contained [VS Code extension](/hooman/guides/vscode/) sub-package — own `package.json`/`tsconfig.json`, excluded from the root build. |
| `docs/`                           | This site — an Astro + Starlight sub-package, deployed to GitHub Pages.                                                                    |
| `scripts/copy-bundled-assets.mjs` | Post-build step that copies Markdown skill/prompt assets into `dist/`.                                                                     |

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

It's deployed to GitHub Pages by `.github/workflows/docs.yml` on pushes to `main` that touch `docs/**`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` (and manual dispatch): root + VS Code `npm ci`, typecheck for both packages, `npx prettier . --check`, root `npm run build`, and VS Code `npm run compile`.

## Release workflow

Releases are tag-driven via `.github/workflows/cd.yml` (also supports manual dispatch). Push a matching `v*` Git tag after bumping versions (root and VS Code extension stay in lockstep). Parallel jobs:

- **Publish npm** — `npm ci`, `npm run build`, then publish to npm with provenance.
- **Publish VS Code extension** — typecheck, package, and publish to the Visual Studio Marketplace.
- **Build CLI bundles** — platform matrix (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`), then **Create GitHub release** attaches the tarballs + checksums.

Docs are separate: `.github/workflows/docs.yml` deploys from pushes to `main` that touch `docs/**` (and manual dispatch). It does not publish packages.
