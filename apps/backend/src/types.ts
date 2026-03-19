// Events
export type EventSource =
  | "ui"
  | "web"
  | "api"
  | "mcp"
  | "scheduler"
  | "internal"
  | "slack"
  | "whatsapp";

export interface BaseEvent {
  id: string;
  source: EventSource;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
  priority?: number;
}

export interface UIChatEvent extends BaseEvent {
  source: "ui";
  type: "message.sent";
  payload: { text: string; userId?: string };
}

export interface ScheduledEvent extends BaseEvent {
  source: "scheduler";
  type: "task.scheduled";
  payload: {
    execute_at: string;
    intent: string;
    context: Record<string, unknown>;
  };
}

export type IncomingEvent = BaseEvent | UIChatEvent | ScheduledEvent;

// Channel configuration (load/save in config; used by adapters and Channels API)
export type FilterMode = "all" | "allowlist" | "blocklist";

export type SlackConnectAs = "bot" | "user";

/** Slack user profile fields (from users.info); used so the LLM can detect when the agent is mentioned by name or in plain text. */
export interface SlackUserProfile {
  connectAs?: SlackConnectAs;
  id: string;
  real_name?: string;
  name?: string;
  display_name?: string;
}

export interface WhatsAppUserProfile {
  id: string;
}

export interface SlackChannelConfig {
  enabled: boolean;
  /** App-level token (xapp-...) for Socket Mode connection. */
  appToken: string;
  /** Bot (xoxb) or User (xoxp) token for API and event subscription. */
  userToken: string;
  /** Use bot token identity vs user token (affects auth.test / agent ID resolution). */
  connectAs?: SlackConnectAs;
  /** Agent identity (bot/user ID) from Slack API; set by worker when linking. Used to verify successful config. */
  agentIdentity?: string;
  /** Agent profile (real_name, name, display_name) from Slack API; set by worker when linking. Used for mention detection. */
  profile?: SlackUserProfile;
  filterMode?: FilterMode;
  filterList?: string[];
}

export interface WhatsAppChannelConfig {
  enabled: boolean;
  /** Folder name only; session is stored under workspace/whatsapp/<sessionPath>. Defaults to "default". */
  sessionPath?: string;
  /** Agent identity (number or ID) set by the worker when WhatsApp client connects. Used to verify successful config. */
  agentIdentity?: string;
  filterMode?: FilterMode;
  filterList?: string[];
}

export interface ChannelsConfig {
  slack?: SlackChannelConfig;
  whatsapp?: WhatsAppChannelConfig;
}

// Normalized events: common payload shape regardless of source (PRD §8)
export type NormalizedPayloadKind =
  | "message"
  | "scheduled_task"
  | "integration_event"
  | "internal";

/** Stored file attachment (saved in attachment store); resolve to path when building model input. */
export interface SavedAttachment {
  id: string;
  originalName: string;
  mimeType: string;
}

export interface MessageEntity {
  name: string;
  id: string;
}

export interface SlackChannel extends MessageEntity {
  type: "dm" | "group_chat" | "public_channel" | "private_channel";
}

export interface WhatsAppChat extends MessageEntity {
  type: "dm" | "group_chat";
}

/** Single Slack message (no parent). */
export interface SlackMessage {
  messageTs: string;
  channel: SlackChannel;
  sender: MessageEntity;
  text: string;
  blocks: unknown[];
  attachments: SavedAttachment[];
  mentions: MessageEntity[];
}

/** Incoming message with optional thread parent (parent is a full {@link SlackMessage}, parent null if not a thread reply). */
export interface SlackMessageWithParent extends SlackMessage {
  parent: SlackMessage | null;
  /** False in IM/mpim: reply in channel; true in channels: prefer thread under this message. */
  replyInThread: boolean;
}

export interface WhatsAppMessage {
  id: string;
  chat: WhatsAppChat;
  sender: MessageEntity;
  text: string;
  attachments: SavedAttachment[];
  mentions: MessageEntity[];
}

export interface WhatsAppMessageWithParent extends WhatsAppMessage {
  parent: WhatsAppMessage | null;
}

/** Slack channel metadata: structured message + agent profile (IDs, thread routing, directness inferred from `message` + `profile`). */
export interface SlackChannelMeta {
  channel: "slack";
  message: SlackMessageWithParent;
  profile: SlackUserProfile;
  connectAs?: SlackConnectAs;
}

/** WhatsApp channel metadata: structured message + agent profile (routing/directness inferred from `message` + `profile`). */
export interface WhatsAppChannelMeta {
  channel: "whatsapp";
  message: WhatsAppMessage | WhatsAppMessageWithParent;
  profile: WhatsAppUserProfile;
}

/** Union of all channel-specific metadata. Delivered in run context to the agent. */
export type ChannelMeta = SlackChannelMeta | WhatsAppChannelMeta;

/** When the model outputs this marker, the dispatcher skips sending a reply to the user (no message to channel; web chat gets chat-skipped). */
export const HOOMAN_SKIP_MARKER = "[hooman:skip]";

export type ChatProgressStage =
  | "thinking"
  | "searching"
  | "organizing"
  | "writing"
  | "awaiting_approval"
  | "done";

/** Payload published to Redis for response delivery. API emits via Socket.IO; Slack/WhatsApp send via their clients. */
export type ResponseDeliveryPayload =
  | {
      channel: "api";
      eventId: string;
      message: {
        role: string;
        text: string;
        /** For approval requests; frontend uses structure instead of parsing text. */
        approvalRequest?: { toolName: string; argsPreview: string };
      };
    }
  | {
      channel: "web";
      eventId: string;
      message: {
        role: string;
        text: string;
        /** For approval requests; frontend uses structure instead of parsing text. */
        approvalRequest?: { toolName: string; argsPreview: string };
      };
    }
  | {
      channel: "api";
      eventId: string;
      progress: {
        stage: ChatProgressStage;
        delta?: string;
        done?: boolean;
      };
    }
  | {
      channel: "web";
      eventId: string;
      progress: {
        stage: ChatProgressStage;
        delta?: string;
        done?: boolean;
      };
    }
  | { channel: "api"; eventId: string; skipped: true }
  | { channel: "web"; eventId: string; skipped: true }
  | { channel: "slack"; channelId: string; threadTs?: string; text: string }
  | {
      channel: "slack";
      channelId: string;
      threadTs?: string;
      status: {
        stage: ChatProgressStage;
        label: string;
        done?: boolean;
      };
    }
  | { channel: "whatsapp"; chatId: string; text: string };

/** Redis channel for response delivery (event-queue publishes; API, Slack and WhatsApp workers subscribe). */
export const RESPONSE_DELIVERY_CHANNEL = "hooman:response_delivery";

export interface NormalizedMessagePayload {
  kind: "message";
  text: string | string[];
  userId: string;
  /** Stored attachments (saved in attachment store); resolve to path when building model input. */
  attachments?: SavedAttachment[];
  /** Present for slack/whatsapp; who, where, message ID, directness. Passed in run context to the agent. */
  channelMeta?: ChannelMeta;
  /** Set when the message text was transcribed from an audio/voice message. */
  sourceMessageType?: "audio";
}

export interface NormalizedScheduledTaskPayload {
  kind: "scheduled_task";
  execute_at?: string;
  intent: string;
  context: Record<string, unknown>;
  cron?: string;
}

export interface ScheduledTask {
  id: string;
  execute_at?: string; // ISO; required for one-shot, absent for recurring
  intent: string;
  context: Record<string, unknown>;
  cron?: string; // when set, task is recurring
}

export interface NormalizedIntegrationEventPayload {
  kind: "integration_event";
  integrationId: string;
  originalType: string;
  payload: Record<string, unknown>;
}

export interface NormalizedInternalPayload {
  kind: "internal";
  data: Record<string, unknown>;
}

export type NormalizedPayload =
  | NormalizedMessagePayload
  | NormalizedScheduledTaskPayload
  | NormalizedIntegrationEventPayload
  | NormalizedInternalPayload;

export interface NormalizedEvent {
  id: string;
  source: EventSource;
  type: string;
  payload: NormalizedPayload;
  timestamp: string;
  priority: number;
}

/** Raw input for dispatch; normalizer converts to NormalizedEvent. */
export interface RawDispatchInput {
  source: EventSource;
  type: string;
  payload: Record<string, unknown>;
  priority?: number;
}

/** Used by channel adapters to enqueue events via BullMQ. */
export type EventDispatcher = {
  dispatch(
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ): Promise<string>;
};

// Decisions
export type DecisionType =
  | "ignore"
  | "respond_directly"
  | "delegate_single"
  | "delegate_multiple"
  | "schedule_future"
  | "ask_user"
  | "escalate_risk";

export interface Decision {
  type: DecisionType;
  eventId: string;
  reasoning?: string;
  payload?: {
    response?: string;
    scheduledAt?: string;
    intent?: string;
    context?: Record<string, unknown>;
    capabilityRequest?: {
      integration: string;
      capability: string;
      reason: string;
    };
  };
}

// Memory
export type MemoryType = "short_term" | "episodic" | "long_term" | "summary";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// Integrations & capabilities
export interface IntegrationCapability {
  integrationId: string;
  capability: string;
  granted: boolean;
  grantedAt?: string;
}

// Audit & safety
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  type:
    | "decision"
    | "action"
    | "permission"
    | "memory_write"
    | "escalation"
    | "scheduled_task"
    | "incoming_message"
    | "tool_call_start"
    | "tool_call_end"
    | "run_summary"
    | "approval_requested"
    | "approval_confirmed"
    | "approval_allow_every_time"
    | "approval_rejected"
    | "approval_tool_execution_failed";
  payload: Record<string, unknown>;
}

export interface KillSwitchState {
  enabled: boolean;
  reason?: string;
  at?: string;
}

// MCP connection configs (Hosted, Streamable HTTP, Stdio)
/** OAuth config for MCP HTTP connections. When present, connection uses full OAuth (PKCE, optional DCR). */
export interface MCPOAuthConfig {
  redirect_uri: string;
  client_id?: string;
  client_secret?: string;
  scope?: string;
  /** Override when discovery from MCP URL is not desired. */
  authorization_server_url?: string;
}

/** Persisted OAuth tokens (internal to payload; do not expose in API). */
export interface MCPOAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** Persisted client info from DCR or pre-registration (internal to payload; do not expose in API). */
export interface MCPOAuthClientInformation {
  client_id: string;
  client_secret?: string;
}

export interface MCPConnectionHosted {
  id: string;
  type: "hosted";
  /** Server label exposed to the model (e.g. "gitmcp"). */
  server_label: string;
  /** Public MCP server URL (required). */
  server_url: string;
  /** Explicit allowlist for tools. Empty/undefined = allow all (unless blocked below). */
  allowedToolNames?: string[];
  /** Explicit blocklist for tools. */
  blockedToolNames?: string[];
  /** Optional headers (e.g. Bearer token for OAuth). */
  headers?: Record<string, string>;
  /** When set, use OAuth (PKCE, optional DCR) for this connection. */
  oauth?: MCPOAuthConfig;
  /** Internal: persisted tokens. Do not expose in API. */
  oauth_tokens?: MCPOAuthTokens;
  /** Internal: PKCE code_verifier during flow. Do not expose in API. */
  oauth_code_verifier?: string;
  /** Internal: client from DCR or pre-reg. Do not expose in API. */
  oauth_client_information?: MCPOAuthClientInformation;
  /** When false, connection is not used for agent tools. Default true. */
  enabled?: boolean;
  created_at?: string;
}

export interface MCPConnectionStreamableHttp {
  id: string;
  type: "streamable_http";
  name: string;
  url: string;
  /** Explicit allowlist for tools. Empty/undefined = allow all (unless blocked below). */
  allowedToolNames?: string[];
  /** Explicit blocklist for tools. */
  blockedToolNames?: string[];
  headers?: Record<string, string>;
  timeout_seconds?: number;
  cache_tools_list?: boolean;
  max_retry_attempts?: number;
  /** When set, use OAuth (PKCE, optional DCR) for this connection. */
  oauth?: MCPOAuthConfig;
  /** Internal: persisted tokens. Do not expose in API. */
  oauth_tokens?: MCPOAuthTokens;
  /** Internal: PKCE code_verifier during flow. Do not expose in API. */
  oauth_code_verifier?: string;
  /** Internal: client from DCR or pre-reg. Do not expose in API. */
  oauth_client_information?: MCPOAuthClientInformation;
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
  /** Explicit allowlist for tools. Empty/undefined = allow all (unless blocked below). */
  allowedToolNames?: string[];
  /** Explicit blocklist for tools. */
  blockedToolNames?: string[];
  /** Optional env vars for the process. */
  env?: Record<string, string>;
  /** Optional working directory. */
  cwd?: string;
  /** When false, connection is not used for agent tools. Default true. */
  enabled?: boolean;
  created_at?: string;
}

export type MCPConnection =
  | MCPConnectionHosted
  | MCPConnectionStreamableHttp
  | MCPConnectionStdio;
