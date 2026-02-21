import type { Request } from "express";
import type { Server as SocketServer } from "socket.io";
import type { RawDispatchInput } from "../types.js";
import type { ChatService } from "../chats/chat-service.js";
import type { AttachmentService } from "../attachments/attachment-service.js";
import type { AuditLog } from "../audit/audit.js";
import type { ScheduleService } from "../scheduling/schedule-service.js";
import type { MCPConnectionsStore } from "../capabilities/mcp/connections-store.js";
import type { SkillService } from "../capabilities/skills/skills-service.js";
import type { McpService } from "../capabilities/mcp/mcp-service.js";
import type { ChannelService } from "../channels/channel-service.js";

export interface AppContext {
  enqueue: (
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ) => Promise<string>;
  chatService: ChatService;
  attachmentService: AttachmentService;
  auditLog: AuditLog;
  responseStore: Map<
    string,
    Array<{ role: "user" | "assistant"; text: string }>
  >;
  scheduler: ScheduleService;
  io: SocketServer;
  mcpConnectionsStore: MCPConnectionsStore;
  skillService: SkillService;
  mcpService: McpService;
  channelService: ChannelService;
}

export function getParam(req: Request, key: string): string {
  const v = req.params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function mask(s: string): string {
  return s?.length ? `${s.slice(0, 4)}…` : "";
}

export function isMasked(s: unknown): boolean {
  return typeof s === "string" && (s.endsWith("…") || s.length < 10);
}
