#!/usr/bin/env bun

import { Command, Option } from "commander";
import { BeforeToolCallEvent } from "@strands-agents/sdk";
import { bootstrap } from "./core/index.ts";
import { TOOLKITS } from "./core/toolkit.ts";
import type { Toolkit } from "./core/toolkit.ts";
import { createToolApprovalHandler } from "./exec/approvals.ts";
import { chat } from "./chat/index.tsx";
import { configure } from "./configure/index.tsx";
import { runAcpStdio } from "./acp/acp-agent.ts";

async function readVersion(): Promise<string> {
  const path = new URL("../package.json", import.meta.url);
  const pkg = (await Bun.file(path).json()) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function createToolkitOption(): Option {
  return new Option(
    "-t, --toolkit <toolkit>",
    "Toolkit size to enable: lite, full, or max.",
  )
    .choices([...TOOLKITS])
    .default("full");
}

const program = new Command()
  .name("hoomanity")
  .description("Hoomanity CLI")
  .version(await readVersion(), "-v, --version")
  .showHelpAfterError(true);

program
  .command("exec")
  .description("Bootstrap an agent and run a single prompt.")
  .argument("<prompt>", "Prompt to run once.")
  .option("-s, --session <id>", "Session ID to use.")
  .addOption(createToolkitOption())
  .action(
    async (
      prompt: string,
      options: { session?: string; toolkit?: Toolkit },
    ) => {
      const sessionId = options.session?.trim() || crypto.randomUUID();
      const {
        config,
        agent,
        mcp: { manager },
      } = await bootstrap(
        { sessionId, toolkit: options.toolkit ?? "full" },
        true,
      );
      agent.addHook(BeforeToolCallEvent, createToolApprovalHandler(config));
      try {
        await agent.invoke(prompt);
      } finally {
        try {
          await manager.disconnect();
        } catch {}
      }
    },
  );

program
  .command("chat")
  .description("Start an interactive, stateful CLI chat session.")
  .argument("[prompt]", "Optional initial prompt to run after startup.")
  .option("-s, --session <id>", "Session ID to use.")
  .addOption(createToolkitOption())
  .action(
    async (
      prompt: string | undefined,
      options: { session?: string; toolkit?: Toolkit },
    ) => {
      const sessionId = options.session?.trim() || crypto.randomUUID();
      const {
        config,
        agent,
        mcp: { manager },
        registry,
      } = await bootstrap(
        { sessionId, toolkit: options.toolkit ?? "full" },
        false,
      );

      try {
        await chat({
          agent,
          config,
          manager,
          registry,
          sessionId,
          initialPrompt: prompt?.trim() || undefined,
        });
      } finally {
        try {
          await manager.disconnect();
        } catch {}
      }
    },
  );

program
  .command("configure")
  .description("Manage app config, MCP servers, and installed skills.")
  .action(async () => {
    await configure();
  });

program
  .command("acp")
  .description(
    "Run as an Agent Client Protocol (ACP) agent on stdio for ACP-compatible clients.",
  )
  .addOption(createToolkitOption())
  .action(async (options: { toolkit?: Toolkit }) => {
    await runAcpStdio(options.toolkit ?? "full");
  });

if (process.argv.slice(2).length === 0) {
  program.help();
}

await program.parseAsync(process.argv);
