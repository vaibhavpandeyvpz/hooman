import React from "react";
import { render } from "ink";
import type { Agent } from "@strands-agents/sdk";
import type { Config } from "../core/config.ts";
import type { Manager as McpManager } from "../core/mcp/index.ts";
import { ChatApp } from "./app.tsx";

type LaunchChatOptions = {
  agent: Agent;
  config: Config;
  manager: McpManager;
  sessionId: string;
  initialPrompt?: string;
};

export async function chat(options: LaunchChatOptions): Promise<void> {
  let done = false;
  const { waitUntilExit, unmount } = render(
    <ChatApp
      agent={options.agent}
      config={options.config}
      manager={options.manager}
      sessionId={options.sessionId}
      initialPrompt={options.initialPrompt}
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
}
