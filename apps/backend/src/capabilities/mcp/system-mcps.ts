import { join } from "path";
import { BACKEND_ROOT, env } from "../../env.js";
import { getChannelsConfig } from "../../config.js";
import type { MCPConnection, MCPConnectionStdio } from "../../types.js";

const DEFAULT_MCP_CWD = env.MCP_STDIO_DEFAULT_CWD;

const MEMORY_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "capabilities",
  "mcp",
  "memory-mcp-server.ts",
);

const SCHEDULE_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "capabilities",
  "mcp",
  "schedule-mcp-server.ts",
);

const WHATSAPP_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "capabilities",
  "mcp",
  "whatsapp-mcp-server.ts",
);

const SKILLS_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "capabilities",
  "mcp",
  "skills-mcp-server.ts",
);

export function getDefaultMcpConnections(): MCPConnectionStdio[] {
  return [
    {
      id: "_default_fetch",
      type: "stdio",
      name: "fetch",
      command: "uvx",
      args: ["mcp-server-fetch"],
      cwd: DEFAULT_MCP_CWD,
    },
    {
      id: "_default_time",
      type: "stdio",
      name: "time",
      command: "uvx",
      args: ["mcp-server-time"],
      cwd: DEFAULT_MCP_CWD,
    },
    {
      id: "_default_filesystem",
      type: "stdio",
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", DEFAULT_MCP_CWD],
    },
    {
      id: "_default_desktop_commander",
      type: "stdio",
      name: "desktop_commander",
      command: "npx",
      args: ["-y", "@wonderwhy-er/desktop-commander@latest", "--no-onboarding"],
      cwd: DEFAULT_MCP_CWD,
      tool_filter:
        "start_process,interact_with_process,read_process_output,force_terminate,list_sessions,list_processes,kill_process",
    },
    {
      id: "_default_thinking",
      type: "stdio",
      name: "thinking",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
    {
      id: "_default_memory",
      type: "stdio",
      name: "memory",
      command: "npx",
      args: ["tsx", MEMORY_MCP_SERVER_PATH],
      cwd: DEFAULT_MCP_CWD,
    },
    {
      id: "_default_schedule",
      type: "stdio",
      name: "schedule",
      command: "npx",
      args: ["tsx", SCHEDULE_MCP_SERVER_PATH],
      cwd: DEFAULT_MCP_CWD,
    },
    {
      id: "_default_skills",
      type: "stdio",
      name: "skills",
      command: "npx",
      args: ["tsx", SKILLS_MCP_SERVER_PATH],
      cwd: DEFAULT_MCP_CWD,
    },
  ];
}

export function getChannelDefaultMcpConnections(): MCPConnectionStdio[] {
  const channels = getChannelsConfig();
  const out: MCPConnectionStdio[] = [];

  if (
    channels.slack?.enabled &&
    channels.slack.userToken?.trim() &&
    channels.slack.agentIdentity?.trim()
  ) {
    const token = channels.slack.userToken.trim();
    const isUser =
      channels.slack.connectAs === "user" || token.startsWith("xoxp-");
    out.push({
      id: "_default_slack",
      type: "stdio",
      name: "slack",
      command: "npx",
      args: ["-y", "slack-mcp-server", "--transport", "stdio"],
      cwd: DEFAULT_MCP_CWD,
      env: isUser
        ? { SLACK_MCP_XOXP_TOKEN: token }
        : { SLACK_MCP_XOXB_TOKEN: token },
    });
  }

  if (channels.whatsapp?.enabled && channels.whatsapp.agentIdentity?.trim()) {
    out.push({
      id: "_default_whatsapp",
      type: "stdio",
      name: "whatsapp",
      command: "npx",
      args: ["tsx", WHATSAPP_MCP_SERVER_PATH],
      cwd: DEFAULT_MCP_CWD,
    });
  }

  return out;
}

export function getAllDefaultMcpConnections(): MCPConnection[] {
  return [...getDefaultMcpConnections(), ...getChannelDefaultMcpConnections()];
}
