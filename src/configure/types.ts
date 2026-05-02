import type { Config as AppConfig } from "../core/config.js";
import type { Config as McpConfig } from "../core/mcp/config.js";
import type { Registry as SkillsRegistry } from "../core/skills/registry.js";

export type ConfigureAppProps = {
  config: AppConfig;
  mcpConfig: McpConfig;
  skills: SkillsRegistry;
  onExit: () => void;
};

export type Screen =
  | { kind: "home" }
  | { kind: "config" }
  | { kind: "config-tools" }
  | { kind: "config-llms" }
  | { kind: "config-llm-edit"; name: string }
  | { kind: "config-llm-provider"; name: string }
  | { kind: "config-llm-delete-confirm"; name: string }
  | { kind: "config-prompts" }
  | { kind: "config-search" }
  | { kind: "config-search-provider" }
  | { kind: "config-ltm" }
  | { kind: "config-wiki" }
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
