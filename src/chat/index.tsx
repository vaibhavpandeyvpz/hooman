import React from "react";
import { render } from "ink";
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
  initialPrompt?: string;
};

export async function chat(options: LaunchChatOptions): Promise<boolean> {
  let done = false;
  const { waitUntilExit, unmount } = render(
    <ChatApp
      agent={options.agent}
      config={options.config}
      manager={options.manager}
      registry={options.registry}
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
  return consumeExitRequest(options.agent);
}
