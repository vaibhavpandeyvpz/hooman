export type View =
  | "chat"
  | "channels"
  | "schedule"
  | "audit"
  | "safety"
  | "capabilities"
  | "settings";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** ISO timestamp; from history or set when sending. */
  timestamp?: string;
  /** Attachment IDs (for user messages); used when loaded from history. */
  attachments?: string[];
  /** Attachment meta for display (from history or after upload). */
  attachment_metas?: { id: string; originalName: string; mimeType: string }[];
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

// MCP connection configs (mirror API types)
/** OAuth config for MCP HTTP connections (PKCE, optional DCR). */
export interface MCPOAuthConfig {
  redirect_uri: string;
  client_id?: string;
  client_secret?: string;
  scope?: string;
  authorization_server_url?: string;
}

export interface MCPConnectionHosted {
  id: string;
  type: "hosted";
  server_label: string;
  server_url: string;
  /** Optional comma-separated glob patterns (e.g. *, !send_*). Empty = all tools. */
  tool_filter?: string;
  headers?: Record<string, string>;
  oauth?: MCPOAuthConfig;
  /** From API when OAuth is configured; not sent on create/update. */
  oauth_has_tokens?: boolean;
  /** When false, connection is not used for agent tools. Default true. */
  enabled?: boolean;
  created_at?: string;
}

export interface MCPConnectionStreamableHttp {
  id: string;
  type: "streamable_http";
  name: string;
  url: string;
  /** Optional comma-separated glob patterns (e.g. *, !send_*). Empty = all tools. */
  tool_filter?: string;
  headers?: Record<string, string>;
  timeout_seconds?: number;
  cache_tools_list?: boolean;
  max_retry_attempts?: number;
  oauth?: MCPOAuthConfig;
  /** From API when OAuth is configured; not sent on create/update. */
  oauth_has_tokens?: boolean;
  /** When false, connection is not used for agent tools. Default true. */
  enabled?: boolean;
  created_at?: string;
}

export interface MCPConnectionStdio {
  id: string;
  type: "stdio";
  name: string;
  command: string;
  args: string[];
  /** Optional comma-separated glob patterns (e.g. *, !send_*). Empty = all tools. */
  tool_filter?: string;
  env?: Record<string, string>;
  cwd?: string;
  /** When false, connection is not used for agent tools. Default true. */
  enabled?: boolean;
  created_at?: string;
}

export type MCPConnection =
  | MCPConnectionHosted
  | MCPConnectionStreamableHttp
  | MCPConnectionStdio;
