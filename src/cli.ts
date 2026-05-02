#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { BeforeToolCallEvent } from "@strands-agents/sdk";
import { bootstrap } from "./core/index.js";
import { createToolApprovalHandler } from "./exec/approvals.js";
import { chat } from "./chat/index.js";
import { configure } from "./configure/index.js";
import { runAcpStdio } from "./acp/acp-agent.js";
import { main as daemon } from "./daemon/index.js";
import { createDaemonApprovalHandler } from "./daemon/approvals.js";
import { createSessionConfig } from "./core/session-config.js";
import {
  consumeExitRequest,
  EXIT_REQUESTED_CODE,
} from "./core/state/exit-request.js";

async function readPackageMeta(): Promise<{
  name: string;
  description: string;
  version: string;
}> {
  const packageUrl = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(packageUrl, "utf8")) as {
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
  .action(
    async (prompt: string, options: { session?: string; yolo?: boolean }) => {
      const sessionId = options.session?.trim() || crypto.randomUUID();
      const {
        agent,
        mcp: { manager },
      } = await bootstrap("default", { sessionId }, true);
      agent.addHook(
        BeforeToolCallEvent,
        createToolApprovalHandler({ yolo: Boolean(options.yolo) }),
      );
      let exitRequested = false;
      try {
        await agent.invoke(prompt);
        exitRequested = consumeExitRequest(agent);
      } finally {
        try {
          await manager.disconnect();
        } catch {}
      }
      if (exitRequested) {
        process.exit(EXIT_REQUESTED_CODE);
      }
    },
  );

program
  .command("chat")
  .description("Start an interactive, stateful CLI chat session.")
  .argument("[prompt]", "Optional initial prompt to run after startup.")
  .option("-s, --session <id>", "Session ID to use.")
  .option("--yolo", "Allow all tools without prompting for approval.")
  .action(
    async (
      prompt: string | undefined,
      options: { session?: string; yolo?: boolean },
    ) => {
      const sessionId = options.session?.trim() || crypto.randomUUID();
      const config = createSessionConfig();
      const {
        agent,
        mcp: { manager },
        registry,
      } = await bootstrap("default", { sessionId }, false, config);

      let exitRequested = false;
      try {
        exitRequested = await chat({
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
      if (exitRequested) {
        process.exit(EXIT_REQUESTED_CODE);
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
  .action(
    async (options: {
      session?: string;
      channels?: boolean;
      debug?: boolean;
      yolo?: boolean;
    }) => {
      const session = options.session?.trim();
      const {
        agent,
        mcp: { manager },
      } = await bootstrap(
        "daemon",
        {
          sessionId: session,
          userId: session,
        },
        true,
      );
      agent.addHook(
        BeforeToolCallEvent,
        createDaemonApprovalHandler(manager, agent, {
          yolo: Boolean(options.yolo),
        }),
      );
      let exitRequested = false;
      try {
        exitRequested = await daemon({
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
      if (exitRequested) {
        process.exit(EXIT_REQUESTED_CODE);
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
  .action(async () => {
    await runAcpStdio();
  });

if (process.argv.slice(2).length === 0) {
  program.help();
}

await program.parseAsync(process.argv);
