#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
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

function cliSessionIdOption(): Option {
  return new Option("-s, --session <id>", "Session ID to use.");
}

function cliSessionModeOption(): Option {
  return new Option(
    "-m, --mode <mode>",
    "Session tool surface: default (full) or ask (read only tools, no plan lifecycle tools).",
  )
    .choices(["default", "ask"])
    .default("default");
}

function cliYoloOption(kind: "interactive" | "daemon"): Option {
  const description =
    kind === "daemon"
      ? "Allow all tools without remote approval or prompts."
      : "Allow all tools without prompting for approval.";
  return new Option("--yolo", description);
}

type CliSessionModeOption = {
  mode: "default" | "ask";
};

/** Shared flags on commands that bootstrap an agent (exec, chat, daemon). */
type CliAgentBootstrapFlags = CliSessionModeOption & {
  session?: string;
  yolo?: boolean;
};

const program = new Command()
  .name(packageMeta.name)
  .description(packageMeta.description)
  .version(packageMeta.version, "-v, --version")
  .showHelpAfterError(true);

program
  .command("exec")
  .description("Bootstrap an agent and run a single prompt.")
  .argument("<prompt>", "Prompt to run once.")
  .addOption(cliSessionIdOption())
  .addOption(cliSessionModeOption())
  .addOption(cliYoloOption("interactive"))
  .action(async (prompt: string, options: CliAgentBootstrapFlags) => {
    const sessionId = options.session?.trim() || crypto.randomUUID();
    const {
      agent,
      mcp: { manager },
    } = await bootstrap(
      "default",
      {
        userId: "default",
        sessionId,
        yolo: Boolean(options.yolo),
        sessionMode: options.mode,
      },
      true,
    );
    agent.addHook(BeforeToolCallEvent, createToolApprovalHandler());
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
  });

program
  .command("chat")
  .description("Start an interactive, stateful CLI chat session.")
  .argument("[prompt]", "Optional initial prompt to run after startup.")
  .addOption(cliSessionIdOption())
  .addOption(cliSessionModeOption())
  .addOption(cliYoloOption("interactive"))
  .action(
    async (prompt: string | undefined, options: CliAgentBootstrapFlags) => {
      const sessionId = options.session?.trim() || crypto.randomUUID();
      const config = createSessionConfig();
      const {
        agent,
        mcp: { manager },
        registry,
      } = await bootstrap(
        "default",
        {
          userId: "default",
          sessionId,
          yolo: Boolean(options.yolo),
          sessionMode: options.mode,
        },
        false,
        config,
      );

      let exitRequested = false;
      try {
        exitRequested = await chat({
          agent,
          config,
          manager,
          registry,
          sessionId,
          prompt: prompt?.trim() || undefined,
          program: packageMeta.name,
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
  .addOption(cliSessionIdOption())
  .addOption(cliSessionModeOption())
  .addOption(cliYoloOption("daemon"))
  .option(
    "--debug",
    "Log each MCP channel notification payload to the console.",
  )
  .action(async (options: CliAgentBootstrapFlags & { debug?: boolean }) => {
    const session = options.session?.trim();
    const {
      agent,
      mcp: { manager },
    } = await bootstrap(
      "daemon",
      {
        userId: session,
        sessionId: session,
        yolo: Boolean(options.yolo),
        sessionMode: options.mode,
      },
      true,
    );
    agent.addHook(
      BeforeToolCallEvent,
      createDaemonApprovalHandler(manager, agent),
    );
    let exitRequested = false;
    try {
      exitRequested = await daemon({
        agent,
        manager,
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
  });

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
