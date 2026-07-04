---
title: Azure
description: Configure the azure provider — options, reasoning, and example configs.
---

Runtime provider id: `azure`. Uses the Vercel AI SDK `@ai-sdk/azure` provider to reach Azure OpenAI.

## Provider options

| Field                    | Type                     | Notes                                                                              |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------------- |
| `resourceName`           | string                   | Optional. Your Azure OpenAI resource name.                                         |
| `baseURL`                | string                   | Optional. Override the resource-derived endpoint.                                  |
| `apiKey`                 | string                   | Optional (or set via environment).                                                 |
| `headers`                | `Record<string, string>` | Optional. Extra HTTP headers.                                                      |
| `apiVersion`             | string                   | Optional. Azure OpenAI API version.                                                |
| `useDeploymentBasedUrls` | boolean                  | Optional. Use `/deployments/<name>` style URLs.                                    |
| `reasoning`              | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

**Important:** set the LLM `model` field to your Azure **deployment name**, not the raw OpenAI model id.

## Reasoning

Reasoning is forwarded to the Azure OpenAI Responses API; only reasoning-capable deployments honor `effort`/`summary`. `display` is not applicable to Azure.

## Example configs

```json
{
  "name": "Azure OpenAI",
  "provider": "azure",
  "options": {
    "resourceName": "my-resource",
    "apiKey": "...",
    "apiVersion": "2024-10-21"
  }
}
```

```json
{
  "name": "GPT-4o (Azure)",
  "provider": "Azure OpenAI",
  "options": {
    "model": "my-gpt-4o-deployment"
  },
  "default": true
}
```

With reasoning summaries on a reasoning-capable deployment:

```json
{
  "name": "Azure Reasoning",
  "provider": "azure",
  "options": {
    "resourceName": "my-resource",
    "apiKey": "...",
    "reasoning": { "effort": "medium", "summary": "detailed" }
  }
}
```

```json
{
  "name": "o4-mini (Azure)",
  "provider": "Azure Reasoning",
  "options": {
    "model": "my-o4-mini-deployment"
  }
}
```
