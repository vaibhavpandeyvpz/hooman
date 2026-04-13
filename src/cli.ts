#!/usr/bin/env bun

import { Command } from "commander";
import { BeforeToolCallEvent } from "@strands-agents/sdk";
import { bootstrap } from "./core/index.ts";
import { createToolApprovalHandler } from "./exec/approvals.ts";
import { chat } from "./chat/index.tsx";
import { configure } from "./configure/index.tsx";

async function readVersion(): Promise<string> {
  const path = new URL("../package.json", import.meta.url);
  const pkg = (await Bun.file(path).json()) as { version?: string };
  return pkg.version ?? "0.0.0";
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
  .action(async (prompt: string, options: { session?: string }) => {
    const sessionId = options.session?.trim() || crypto.randomUUID();
    const {
      config,
      agent,
      mcp: { manager },
    } = await bootstrap(sessionId, sessionId, true);
    agent.addHook(BeforeToolCallEvent, createToolApprovalHandler(config));
    try {
      await agent.invoke(prompt);
    } finally {
      try {
        await manager.disconnect();
      } catch {}
    }
  });

program
  .command("chat")
  .description("Start an interactive, stateful CLI chat session.")
  .argument("[prompt]", "Optional initial prompt to run after startup.")
  .option("-s, --session <id>", "Session ID to use.")
  .action(async (prompt: string | undefined, options: { session?: string }) => {
    const sessionId = options.session?.trim() || crypto.randomUUID();
    const {
      config,
      agent,
      mcp: { manager },
      registry,
    } = await bootstrap(sessionId, sessionId, false);

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
  });

program
  .command("configure")
  .description("Manage app config, MCP servers, and installed skills.")
  .action(async () => {
    await configure();
  });

if (process.argv.slice(2).length === 0) {
  program.help();
}

await program.parseAsync(process.argv);
