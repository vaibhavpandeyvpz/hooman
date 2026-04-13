import type { Config as AppConfig } from "../core/config.ts";
import type { Config as McpConfig } from "../core/mcp/config.ts";
import type { Registry as SkillsRegistry } from "../core/skills/registry.ts";

export type ConfigureAppProps = {
  config: AppConfig;
  mcpConfig: McpConfig;
  skills: SkillsRegistry;
  onExit: () => void;
};

export type Screen =
  | { kind: "home" }
  | { kind: "config" }
  | { kind: "config-provider" }
  | { kind: "mcp" }
  | { kind: "mcp-delete-confirm"; name: string }
  | { kind: "skills" }
  | { kind: "skills-delete-confirm"; folder: string; displayName: string }
  | { kind: "skills-search-results"; query: string };

export type Notice = {
  kind: "success" | "error" | "info";
  text: string;
};

export type PromptState = {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  note?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel?: () => void;
};

export type MenuAction = () => void | Promise<void>;

export type MenuItem = {
  key?: string;
  label: string;
  /** First occurrence in `label` is rendered bold (MCP server name, skill title, etc.). */
  boldSubstring?: string;
  value: MenuAction;
};
