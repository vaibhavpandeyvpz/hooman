import React from "react";
import { render } from "ink";
import { styleText } from "node:util";
import type { Agent } from "@strands-agents/sdk";
import type { Config } from "../core/config.js";
import type { Manager as McpManager } from "../core/mcp/index.js";
import type { Registry } from "../core/skills/index.js";
import { consumeExitRequest } from "../core/state/exit-request.js";
import { ChatApp } from "./app.js";

type LaunchChatOptions = {
  agent: Agent;
  config: Config;
  manager: McpManager;
  registry: Registry;
  sessionId: string;
  prompt?: string;
  /** CLI binary name for resume hint (from package.json `bin`). */
  program?: string;
};

function printSessionResumeHint(program: string, sessionId: string): void {
  const exe = program.trim() || "hooman";
  console.log("");
  console.log(styleText(["dim", "gray"], " Resume this session next time:"));
  console.log(`   ${exe} chat -s ${sessionId}`);
}

export async function chat(options: LaunchChatOptions): Promise<boolean> {
  let done = false;
  const { waitUntilExit, unmount } = render(
    <ChatApp
      agent={options.agent}
      config={options.config}
      manager={options.manager}
      registry={options.registry}
      sessionId={options.sessionId}
      prompt={options.prompt}
      onExit={() => {
        done = true;
      }}
    />,
    { exitOnCtrlC: false },
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
