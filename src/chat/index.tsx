import React from "react";
import { render } from "ink";
import type { Agent } from "@strands-agents/sdk";
import type { Manager as McpManager } from "../core/mcp/index.js";
import type { Registry } from "../core/skills/index.js";
import { ChatApp } from "./app.js";

type LaunchChatOptions = {
  agent: Agent;
  manager: McpManager;
  registry: Registry;
  sessionId: string;
  initialPrompt?: string;
  yolo?: boolean;
};

export async function chat(options: LaunchChatOptions): Promise<void> {
  let done = false;
  const { waitUntilExit, unmount } = render(
    <ChatApp
      agent={options.agent}
      manager={options.manager}
      registry={options.registry}
      sessionId={options.sessionId}
      initialPrompt={options.initialPrompt}
      yolo={options.yolo}
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
