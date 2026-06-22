#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { bootstrap } from "./core/index.js";
import { createMcpConfig, createMcpManager } from "./core/mcp/index.js";
import { createToolApprovalIntervention } from "./exec/approvals.js";
import { chat } from "./chat/index.js";
import {
  ChatApprovalController,
  createChatApprovalIntervention,
} from "./chat/approvals.js";
import {
  ChatTurnSteeringController,
  createChatTurnSteeringIntervention,
} from "./chat/steering.js";
import { configure } from "./configure/index.js";
import { runAcpStdio } from "./acp/acp-agent.js";
import { main as daemon } from "./daemon/index.js";
import { createDaemonApprovalIntervention } from "./daemon/approvals.js";
import {
  flushAgentMemory,
  runWithAgentMemoryScope,
} from "./core/memory/index.js";
import { createSessionConfig } from "./core/session-config.js";
import { mcpJsonPath } from "./core/utils/paths.js";
import {
  consumeExitRequest,
  EXIT_REQUESTED_CODE,
} from "./core/state/exit-request.js";
import { getModeState, type SessionMode } from "./core/state/session-mode.js";
import { isYoloEnabled } from "./core/state/yolo.js";
import { formatModeNames, getModeIds } from "./core/modes/index.js";

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
    `Session mode: ${formatModeNames()}. Agent is the full tool surface; ask is read-oriented; plan is the plan-file workflow.`,
  )
    .choices(getModeIds())
    .default("agent");
}

function cliYoloOption(kind: "interactive" | "daemon"): Option {
  const description =
    kind === "daemon"
      ? "Allow all tools without remote approval or prompts."
      : "Allow all tools without prompting for approval.";
  return new Option("--yolo", description);
}

type CliSessionModeOption = {
  mode: string;
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
        interventions: [createToolApprovalIntervention()],
      },
      true,
    );
    let exitRequested = false;
    try {
      await runWithAgentMemoryScope(agent, () => agent.invoke(prompt));
      exitRequested = consumeExitRequest(agent);
    } finally {
      try {
        await flushAgentMemory(agent);
      } catch {}
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
      const config = createSessionConfig();
      let currentSessionId = options.session?.trim() || crypto.randomUUID();
      let currentPrompt = prompt?.trim() || undefined;
      let currentYolo = Boolean(options.yolo);
      let currentMode = options.mode as SessionMode;
      let exitRequested = false;
      while (true) {
        const approvals = new ChatApprovalController();
        const steering = new ChatTurnSteeringController();
        const {
          agent,
          mcp: { manager },
          registry,
        } = await bootstrap(
          "default",
          {
            userId: "default",
            sessionId: currentSessionId,
            yolo: currentYolo,
            sessionMode: currentMode,
            interventions: [
              createChatApprovalIntervention(approvals),
              createChatTurnSteeringIntervention(steering),
            ],
          },
          false,
          config,
        );

        try {
          const result = await chat({
            agent,
            config,
            manager,
            registry,
            sessionId: currentSessionId,
            prompt: currentPrompt,
            approvals,
            steering,
            program: packageMeta.name,
          });
          if (result.nextAction === "configure") {
            await configure();
            config.reload();
            currentPrompt = undefined;
            // The config flow restored the chat screen on exit; clear it so the
            // re-bootstrapped session (which picks up any config changes) renders
            // cleanly instead of stacking below the restored frame.
            process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
            continue;
          }
          if (result.nextAction === "new") {
            currentSessionId = crypto.randomUUID();
            currentPrompt = undefined;
            currentYolo = isYoloEnabled(agent);
            currentMode = getModeState(agent).mode;
            continue;
          }
          exitRequested = result.exitRequested;
          break;
        } finally {
          try {
            await flushAgentMemory(agent);
          } catch {}
          try {
            await manager.disconnect();
          } catch {}
        }
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
        createInterventions: ({ manager }) => [
          createDaemonApprovalIntervention(manager),
        ],
      },
      true,
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
        await flushAgentMemory(agent);
      } catch {}
      try {
        await manager.disconnect();
      } catch {}
    }
    if (exitRequested) {
      process.exit(EXIT_REQUESTED_CODE);
    }
  });

const mcp = program
  .command("mcp")
  .description("Manage MCP server authentication and status.");

mcp
  .command("auth")
  .description("Authenticate a remote MCP server with OAuth.")
  .argument("<server>", "Configured MCP server name.")
  .action(async (serverName: string) => {
    const manager = createMcpManager(createMcpConfig(mcpJsonPath()));
    try {
      await manager.authenticate(serverName.trim());
      console.log(`Authenticated MCP server "${serverName.trim()}".`);
    } finally {
      await manager.disconnect().catch(() => undefined);
    }
  });

mcp
  .command("logout")
  .description("Remove stored OAuth credentials for a remote MCP server.")
  .argument("<server>", "Configured MCP server name.")
  .addOption(
    new Option(
      "--scope <scope>",
      "Credentials to clear: all, client, tokens, or discovery.",
    )
      .choices(["all", "client", "tokens", "discovery"])
      .default("all"),
  )
  .action(
    async (
      serverName: string,
      options: { scope: "all" | "client" | "tokens" | "discovery" },
    ) => {
      const manager = createMcpManager(createMcpConfig(mcpJsonPath()));
      try {
        await manager.logout(serverName.trim(), options.scope);
        console.log(
          `Cleared ${options.scope} OAuth credentials for MCP server "${serverName.trim()}".`,
        );
      } finally {
        await manager.disconnect().catch(() => undefined);
      }
    },
  );

mcp
  .command("auth-status")
  .description("Show OAuth status for configured MCP servers.")
  .action(async () => {
    const manager = createMcpManager(createMcpConfig(mcpJsonPath()));
    try {
      const statuses = await manager.listAuthStatuses();
      if (statuses.length === 0) {
        console.log("No MCP servers configured.");
        return;
      }
      for (const status of statuses) {
        console.log(
          `${status.name}\t${status.transportType}\t${status.status}`,
        );
      }
    } finally {
      await manager.disconnect().catch(() => undefined);
    }
  });

program
  .command("acp")
  .description(
    "Run as an Agent Client Protocol (ACP) agent on stdio for ACP-compatible clients.",
  )
  .action(async () => {
    await runAcpStdio();
  });

const argv =
  process.argv.slice(2).length === 0 ? [...process.argv, "chat"] : process.argv;

await program.parseAsync(argv);
