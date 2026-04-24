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
import { main as daemon } from "./daemon/index.ts";
import { createDaemonApprovalHandler } from "./daemon/approvals.ts";

async function readPackageMeta(): Promise<{
  name: string;
  description: string;
  version: string;
}> {
  const path = new URL("../package.json", import.meta.url);
  const pkg = (await Bun.file(path).json()) as {
    bin?: string | Record<string, string>;
    name?: string;
    description?: string;
    version?: string;
  };
  const commandName =
    typeof pkg.bin === "string"
      ? pkg.name
      : pkg.bin && typeof pkg.bin === "object"
        ? Object.keys(pkg.bin)[0]
        : undefined;
  return {
    name: commandName ?? pkg.name ?? "hooman",
    description: pkg.description ?? "Hooman CLI",
    version: pkg.version ?? "0.0.0",
  };
}

function createToolkitOption(): Option {
  return new Option(
    "-t, --toolkit <toolkit>",
    "Toolkit size to enable: lite, full, or max.",
  )
    .choices([...TOOLKITS])
    .default("full");
}

const packageMeta = await readPackageMeta();

const program = new Command()
  .name(packageMeta.name)
  .description(packageMeta.description)
  .version(packageMeta.version, "-v, --version")
  .showHelpAfterError(true);

program
  .command("exec")
  .description("Bootstrap an agent and run a single prompt.")
  .argument("<prompt>", "Prompt to run once.")
  .option("-s, --session <id>", "Session ID to use.")
  .option("--yolo", "Allow all tools without prompting for approval.")
  .addOption(createToolkitOption())
  .action(
    async (
      prompt: string,
      options: { session?: string; toolkit?: Toolkit; yolo?: boolean },
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
      agent.addHook(
        BeforeToolCallEvent,
        createToolApprovalHandler(config, { yolo: Boolean(options.yolo) }),
      );
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
  .option("--yolo", "Allow all tools without prompting for approval.")
  .addOption(createToolkitOption())
  .action(
    async (
      prompt: string | undefined,
      options: { session?: string; toolkit?: Toolkit; yolo?: boolean },
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
          yolo: Boolean(options.yolo),
        });
      } finally {
        try {
          await manager.disconnect();
        } catch {}
      }
    },
  );

program
  .command("daemon")
  .description(
    "Run a background daemon that processes MCP channel notifications as prompts.",
  )
  .option("-s, --session <id>", "Session ID to use.")
  .option("--channels", "Subscribe to MCP servers advertising hooman/channel.")
  .option(
    "--debug",
    "Log each MCP channel notification payload to the console.",
  )
  .option("--yolo", "Allow all tools without remote approval or prompts.")
  .addOption(createToolkitOption())
  .action(
    async (options: {
      session?: string;
      toolkit?: Toolkit;
      channels?: boolean;
      debug?: boolean;
      yolo?: boolean;
    }) => {
      const session = options.session?.trim();
      const {
        config,
        agent,
        mcp: { manager },
      } = await bootstrap(
        {
          sessionId: session,
          userId: session,
          toolkit: options.toolkit ?? "full",
        },
        true,
      );
      agent.addHook(
        BeforeToolCallEvent,
        createDaemonApprovalHandler(config, manager, agent, {
          yolo: Boolean(options.yolo),
        }),
      );
      try {
        await daemon({
          agent,
          manager,
          channels: Boolean(options.channels),
          session,
          debug: Boolean(options.debug),
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
