---
title: Prompts
description: Toggle bundled harness prompt sections via the prompts block in config.json.
---

The `prompts` block toggles bundled "harness" prompt sections that get folded into the system prompt. Each field is optional and defaults to `true`; set one to `false` only when you explicitly want to omit that section.

## Fields

| Field           | Default | Section                                                                                          |
| --------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `behaviour`     | `true`  | High-level operating stance: inferring intent, staying scoped, surfacing risks, verifying work.  |
| `communication` | `true`  | How the agent talks to the user: concise, direct, no filler, clear final summaries.              |
| `execution`     | `true`  | The understand → gather context → act → verify → report loop and tool-choice guidance.           |
| `guardrails`    | `true`  | Security/risk posture: permission boundaries, security-request handling, prompt/data boundaries. |

Coding and software-engineering guidance is **not** a prompt toggle — it lives in the built-in `hooman-coding` skill and loads automatically when relevant. Custom, always-on instructions belong in `~/.hooman/instructions.md`, not this block.

## Example configs

Defaults (all sections on — equivalent to omitting `prompts` entirely):

```json
{
  "prompts": {
    "behaviour": true,
    "communication": true,
    "execution": true,
    "guardrails": true
  }
}
```

Drop the guardrails section (e.g. because your own `instructions.md` fully replaces it):

```json
{
  "prompts": {
    "guardrails": false
  }
}
```

`/config` in an interactive `chat` session can toggle these without hand-editing JSON — see [`/config`](/hooman/guides/cli/#config).
