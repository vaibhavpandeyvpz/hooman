import React from "react";
import { mkdir } from "node:fs/promises";
import { render } from "ink";
import { ConfigureApp } from "./app.tsx";
import { Config as AppConfig } from "../core/config.ts";
import { Config as McpConfig } from "../core/mcp/config.ts";
import { createSkillsRegistry } from "../core/skills/index.ts";
import {
  basePath,
  configJsonPath,
  mcpJsonPath,
  skillsPath,
} from "../core/utils/paths.ts";

export async function configure(): Promise<void> {
  await mkdir(basePath(), { recursive: true });
  await mkdir(skillsPath(), { recursive: true });

  const config = new AppConfig(configJsonPath());
  const mcpConfig = new McpConfig(mcpJsonPath());
  const skills = createSkillsRegistry(basePath());

  let done = false;
  const { waitUntilExit, unmount } = render(
    <ConfigureApp
      config={config}
      mcpConfig={mcpConfig}
      skills={skills}
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
