---
title: Bedrock
description: Configure the bedrock provider — options, reasoning, and example configs.
---

Runtime provider id: `bedrock`. Talks to Amazon Bedrock's Converse API.

## Provider options

| Field             | Type   | Notes                                                                              |
| ----------------- | ------ | ---------------------------------------------------------------------------------- |
| `region`          | string | Optional. AWS region.                                                              |
| `accessKeyId`     | string | Optional. Must be provided together with `secretAccessKey`.                        |
| `secretAccessKey` | string | Optional. Must be provided together with `accessKeyId`.                            |
| `sessionToken`    | string | Optional. For temporary credentials.                                               |
| `apiKey`          | string | Optional. Alternate Bedrock API key auth.                                          |
| `reasoning`       | object | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

Bedrock can rely on the AWS default credential chain (environment, shared config, instance role, etc.) when explicit credentials are omitted — in that case leave `accessKeyId`/`secretAccessKey`/`apiKey` unset and set only `region` (or nothing, to use the default region too).

## Reasoning

Providing `reasoning` enables extended thinking on supported models (e.g. Claude on Bedrock), sent as `thinking: { type: "enabled", budget_tokens }`. `effort` defaults to `medium` and always maps to an explicit `budget_tokens` (Converse requires one):

| `effort`  | `budget_tokens` |
| --------- | --------------- |
| `minimal` | 1024            |
| `low`     | 2048            |
| `medium`  | 4096            |
| `high`    | 8192            |

`display` applies to Bedrock Claude: newer models (Opus 4.7+) default reasoning display to omitted; set `display: "summarized"` to receive the reasoning trace. Setting `display` switches the request to `adaptive` thinking with `output_config.effort` (required by Opus, accepted by Sonnet).

## Example configs

Using the AWS default credential chain:

```json
{
  "name": "Bedrock",
  "provider": "bedrock",
  "options": {
    "region": "us-east-1"
  }
}
```

```json
{
  "name": "Claude Sonnet (Bedrock)",
  "provider": "Bedrock",
  "options": {
    "model": "anthropic.claude-sonnet-4-6"
  },
  "default": true
}
```

With explicit credentials and reasoning display on Opus:

```json
{
  "name": "Bedrock Explicit",
  "provider": "bedrock",
  "options": {
    "region": "us-west-2",
    "accessKeyId": "AKIA...",
    "secretAccessKey": "...",
    "reasoning": { "effort": "high", "display": "summarized" }
  }
}
```

```json
{
  "name": "Claude Opus (Bedrock, thinking)",
  "provider": "Bedrock Explicit",
  "options": {
    "model": "anthropic.claude-opus-4-7"
  }
}
```
