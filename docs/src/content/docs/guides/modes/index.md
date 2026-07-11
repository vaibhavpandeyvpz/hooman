---
title: Overview
description: Session modes — Agent, Plan, Ask, and Design — and how to switch between them.
---

Hooman sessions always run in one of four **modes**. Each mode changes the system prompt and the built-in tool allowlist so the agent stays in the right posture for the work.

| Mode                                   | Best for                | Highlights                                                                                                                    |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [Agent](/hooman/guides/modes/agent/)   | Implementation          | Full tool surface including shell and filesystem writes                                                                       |
| [Plan](/hooman/guides/modes/plan/)     | Scoping before coding   | Plan document + checklist; no shell; leave plan only with approval                                                            |
| [Ask](/hooman/guides/modes/ask/)       | Questions & exploration | Read-oriented surface; switch out when you need to implement or design                                                        |
| [Design](/hooman/guides/modes/design/) | UI / decks / handoff    | HTML under `.hooman/design/`; preview; PDF / PowerPoint-ready `.pptx` / Figma-ready `.fig` / `.deck` / Sketch-ready `.sketch` |

**Yolo is not a mode.** It is a separate auto-approve toggle (`--yolo`, `/yolo`, ACP `yolo`) that still never auto-approves `switch_mode`.

## Switching

```bash
hooman chat --mode plan
hooman exec "Summarize the auth flow" --mode ask
```

In chat: `/mode` → pick `agent`, `ask`, `plan`, or `design`.

The agent can propose a switch with [`switch_mode`](/hooman/guides/tools/#switch_mode) — always requires your explicit approval (including leaving plan).

VS Code and other ACP clients expose the same four values in the session controls.
