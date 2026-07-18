import { z } from "zod";

/**
 * Shared IPC schemas for the main <-> preload <-> renderer boundary. Every
 * `ipcMain.handle` validates its input against these before touching the
 * filesystem or a child process, per the plan's IPC-authorization
 * requirement. The renderer never receives anything not modeled here.
 */

export const openProjectRequest = z.object({ cwd: z.string().min(1) });
export type OpenProjectRequest = z.infer<typeof openProjectRequest>;

export const projectSessionRequest = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
});
export type ProjectSessionRequest = z.infer<typeof projectSessionRequest>;

export const projectOnlyRequest = z.object({ projectId: z.string().min(1) });
export type ProjectOnlyRequest = z.infer<typeof projectOnlyRequest>;

const MAX_ATTACHMENT_BASE64_LENGTH = 30_000_000; // ~22MB decoded, generous for a single image/file attachment

export const promptContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(50_000) }),
  z.object({
    type: z.literal("image"),
    data: z.string().min(1).max(MAX_ATTACHMENT_BASE64_LENGTH),
    mimeType: z.string().min(1),
  }),
  z.object({
    type: z.literal("resource"),
    resource: z.object({
      uri: z.string().min(1),
      mimeType: z.string().optional(),
      text: z.string().max(MAX_ATTACHMENT_BASE64_LENGTH).optional(),
      blob: z.string().max(MAX_ATTACHMENT_BASE64_LENGTH).optional(),
    }),
  }),
  // Path-backed attachment sent by reference (file or directory picked via
  // the native OS dialog) — the agent never reads its bytes, just its uri.
  z.object({
    type: z.literal("resource_link"),
    uri: z.string().min(1),
    name: z.string().min(1),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  }),
]);

export const promptRequest = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  prompt: z.array(promptContentBlockSchema).min(1).max(50),
});
export type PromptRequest = z.infer<typeof promptRequest>;

export const cancelRequest = projectSessionRequest;
export type CancelRequest = z.infer<typeof cancelRequest>;

export const stopShellJobRequest = projectSessionRequest.extend({
  jobId: z.string().min(1),
});
export type StopShellJobRequest = z.infer<typeof stopShellJobRequest>;

export const writeFileRequest = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  /** `null` deletes the file (undoing a create). */
  content: z.string().nullable(),
});
export type WriteFileRequest = z.infer<typeof writeFileRequest>;

export const setConfigOptionRequest = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  configId: z.string().min(1),
  value: z.union([z.string(), z.boolean()]),
});
export type SetConfigOptionRequest = z.infer<typeof setConfigOptionRequest>;

export const mcpTransportSchema = z.object({
  type: z.enum(["stdio", "streamable-http", "sse"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const mcpUpsertRequest = z.object({
  name: z.string().min(1),
  transport: mcpTransportSchema,
});
export type McpUpsertRequest = z.infer<typeof mcpUpsertRequest>;

export const mcpDeleteRequest = z.object({ name: z.string().min(1) });
export type McpDeleteRequest = z.infer<typeof mcpDeleteRequest>;

export const providerUpsertRequest = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type ProviderUpsertRequest = z.infer<typeof providerUpsertRequest>;

export const providerDeleteRequest = z.object({ name: z.string().min(1) });
export type ProviderDeleteRequest = z.infer<typeof providerDeleteRequest>;

export const llmUpsertRequest = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  options: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  default: z.boolean().optional(),
});
export type LlmUpsertRequest = z.infer<typeof llmUpsertRequest>;

export const llmDeleteRequest = z.object({ name: z.string().min(1) });
export type LlmDeleteRequest = z.infer<typeof llmDeleteRequest>;

export const generalSaveRequest = z.object({
  name: z.string().min(1).optional(),
  reasoning: z.enum(["collapsed", "full"]).optional(),
  compaction: z
    .object({
      ratio: z.number().min(0).max(1).optional(),
      keep: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type GeneralSaveRequest = z.infer<typeof generalSaveRequest>;

export const promptToggleRequest = z.object({
  key: z.enum(["behaviour", "communication", "execution", "guardrails"]),
  value: z.boolean(),
});
export type PromptToggleRequest = z.infer<typeof promptToggleRequest>;

export const toolToggleRequest = z.object({
  key: z.enum([
    "todo",
    "fetch",
    "filesystem",
    "shell",
    "sleep",
    "browser",
    "subagents",
  ]),
  value: z.boolean(),
});
export type ToolToggleRequest = z.infer<typeof toolToggleRequest>;

export const searchSaveRequest = z.object({
  enabled: z.boolean().optional(),
  provider: z
    .enum([
      "brave",
      "duckduckgo",
      "exa",
      "firecrawl",
      "litellm",
      "serper",
      "tavily",
    ])
    .optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  tool: z.string().optional(),
});
export type SearchSaveRequest = z.infer<typeof searchSaveRequest>;

export const skillsSearchRequest = z.object({ query: z.string() });
export type SkillsSearchRequest = z.infer<typeof skillsSearchRequest>;

export const skillsInstallRequest = z.object({ source: z.string().min(1) });
export type SkillsInstallRequest = z.infer<typeof skillsInstallRequest>;

export const skillsDeleteRequest = z.object({ folder: z.string().min(1) });
export type SkillsDeleteRequest = z.infer<typeof skillsDeleteRequest>;

export const acpNotificationEvent = z.object({
  projectId: z.string(),
  method: z.string(),
  params: z.unknown(),
});
export type AcpNotificationEvent = z.infer<typeof acpNotificationEvent>;
