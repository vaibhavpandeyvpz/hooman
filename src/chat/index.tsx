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
    ` ${styleText(["white", "bold"], "Resume using:")} ${styleText(
      ["white"],
      `${exe} chat -s ${sessionId}`,
    )}`,
  );
}

export async function chat(options: LaunchChatOptions): Promise<boolean> {
  // MCP auth state is surfaced inline in the status bar ("mcp servers: N (needs
  // attention)") rather than printed above the chat, so the banner/transcript
  // starts at the top of a clean screen.
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
      // Render into the normal terminal buffer (not the alternate screen) so
      // finished transcript lines flushed via <Static> become real scrollback.
      // The terminal's own scrolling then works natively; no manual paging.
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
