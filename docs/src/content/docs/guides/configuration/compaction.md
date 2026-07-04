---
title: Compaction
description: Tune context compaction via the compaction block in config.json.
---

The `compaction` block tunes how the agent's conversation history gets compacted once it grows large. Both fields are optional and are filled in with defaults on load.

## Fields

| Field   | Type   | Default | Notes                                                                                               |
| ------- | ------ | ------- | --------------------------------------------------------------------------------------------------- |
| `ratio` | number | `0.75`  | Target fraction of context window to occupy after compaction. Must be `0..1`.                       |
| `keep`  | number | `5`     | Minimum number of recent turns/message groups to preserve verbatim. Must be a non-negative integer. |

Compaction can also be triggered manually mid-session with `/compact` in `chat` — see [Chat commands](/hooman/guides/cli/#chat-commands).

## Example configs

Defaults (equivalent to omitting `compaction` entirely):

```json
{
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

More aggressive compaction, keeping fewer verbatim turns:

```json
{
  "compaction": {
    "ratio": 0.5,
    "keep": 2
  }
}
```
