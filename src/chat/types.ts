import type { FileToolDisplay } from "../core/state/file-tool-display.js";

export type ChatRole = "user" | "assistant" | "tool" | "system";

export interface ChatLine {
  id: string;
  role: ChatRole;
  title?: string;
  content: string;
  done?: boolean;
  toolName?: string;
  phase?: "running" | "done";
  resultContent?: string;
  fileToolDisplay?: FileToolDisplay;
}

export type ApprovalDecision = "allow" | "reject" | "always";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  description?: string;
  inputPreview: string;
}
