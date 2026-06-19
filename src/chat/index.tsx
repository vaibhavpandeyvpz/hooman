import React from "react";
import { render } from "ink";
import { styleText } from "node:util";
import type { Agent } from "@strands-agents/sdk";
import type { Config } from "../core/config.js";
import type { Manager as McpManager } from "../core/mcp/index.js";
import type { Registry } from "../core/skills/index.js";
import { consumeExitRequest } from "../core/state/exit-request.js";
import type { ChatApprovalController } from "./approvals.js";
import type { ChatTurnSteeringController } from "./steering.js";
import { ChatApp } from "./app.js";

type LaunchChatOptions = {
  agent: Agent;
  config: Config;
  manager: McpManager;
  registry: Registry;
  sessionId: string;
  prompt?: string;
  approvals: ChatApprovalController;
  steering: ChatTurnSteeringController;
  /** CLI binary name for resume hint (from package.json `bin`). */
  program?: string;
};

function printSessionResumeHint(program: string, sessionId: string): void {
  const exe = program.trim() || "hooman";
  console.log("");
  console.log(
    styleText(["dim", "gray"], ` Resume using: ${exe} chat -s ${sessionId}`),
  );
}

async function printMcpAuthHint(
  manager: McpManager,
  program: string,
): Promise<void> {
  const exe = program.trim() || "hooman";
  const rows = await manager.listAuthStatuses().catch(() => []);
  const pending = rows.filter(
    (row) => row.status === "unauthenticated" || row.status === "expired",
  );
  if (pending.length === 0) {
    return;
  }

  console.log("");
  console.log(
    styleText(
      ["yellow"],
      " Some MCP servers need OAuth before their tools can be used:",
    ),
  );
  for (const row of pending) {
    const suffix = row.status === "expired" ? " (expired)" : "";
    console.log(` - ${row.name}${suffix}: ${exe} mcp auth ${row.name}`);
  }
}

export async function chat(options: LaunchChatOptions): Promise<boolean> {
  await printMcpAuthHint(options.manager, options.program ?? "hooman");
  let done = false;
  const { waitUntilExit, unmount } = render(
    <ChatApp
      agent={options.agent}
      config={options.config}
      manager={options.manager}
      registry={options.registry}
      sessionId={options.sessionId}
      prompt={options.prompt}
      approvals={options.approvals}
      steering={options.steering}
      onExit={() => {
        done = true;
      }}
    />,
    {
      alternateScreen: true,
      exitOnCtrlC: false,
    },
  );

  try {
    await waitUntilExit();
  } finally {
    if (!done) {
      unmount();
    }
  }
  printSessionResumeHint(options.program ?? "hooman", options.sessionId);
  return consumeExitRequest(options.agent);
}
