import type { FileToolDisplay } from "../core/state/file-tool-display.js";

export type ChatRole = "user" | "assistant" | "tool" | "system";
export type ChatTimelineRole = ChatRole | "thought";

export interface ChatLine {
  id: string;
  role: ChatTimelineRole;
  title?: string;
  content: string;
  done?: boolean;
  toolName?: string;
  phase?: "running" | "done";
  resultContent?: string;
  fileToolDisplay?: FileToolDisplay;
  startedAt?: number;
  finishedAt?: number;
  estimatedTokens?: number;
}

export type ApprovalDecision = "allow" | "reject" | "always";

export interface ApprovalResolution {
  decision: ApprovalDecision;
  reason?: string;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  description?: string;
  inputPreview: string;
  preview?: string;
}
