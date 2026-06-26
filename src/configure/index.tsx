import { mkdir } from "node:fs/promises";
import { render } from "ink";
import { ConfigureApp } from "./app.js";
import { Config as AppConfig } from "../core/config.js";
import { Config as McpConfig, createMcpManager } from "../core/mcp/index.js";
import { createSkillsRegistry } from "../core/skills/index.js";
import {
  basePath,
  configJsonPath,
  mcpJsonPath,
  skillsPath,
} from "../core/utils/paths.js";

/** Switch to the terminal's alternate screen buffer (clears it, homes the cursor). */
const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
/** Restore the original screen buffer, bringing back whatever was on screen before. */
const EXIT_ALT_SCREEN = "\x1b[?1049l";

export async function configure(): Promise<void> {
  await mkdir(basePath(), { recursive: true });
  await mkdir(skillsPath(), { recursive: true });

  const config = new AppConfig(configJsonPath());
  const mcpConfig = new McpConfig(mcpJsonPath());
  const mcpManager = createMcpManager(mcpConfig);
  const skills = createSkillsRegistry(basePath());

  // Render the configuration flow on the alternate screen buffer so it takes
  // over the whole terminal. On exit the terminal restores the previous screen
  // (e.g. the chat session) exactly as it was, without polluting scrollback.
  process.stdout.write(ENTER_ALT_SCREEN);

  let done = false;
  const { waitUntilExit, unmount } = render(
    <ConfigureApp
      config={config}
      mcpConfig={mcpConfig}
      mcpManager={mcpManager}
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
    await mcpManager.disconnect().catch(() => undefined);
    if (!done) {
      unmount();
    }
    process.stdout.write(EXIT_ALT_SCREEN);
  }
}
