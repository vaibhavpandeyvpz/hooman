#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { configureLogging } from "@strands-agents/sdk";
import { bootstrap } from "./core/index.js";
import { createMcpConfig, createMcpManager } from "./core/mcp/index.js";
import { createToolApprovalIntervention } from "./exec/approvals.js";
import { chat } from "./chat/index.js";
import {
  ChatApprovalController,
  createChatApprovalIntervention,
} from "./chat/approvals.js";
import {
  ChatQuestionController,
  createChatAskUserBackend,
} from "./chat/questions.js";
import { setAskUserBackend } from "./core/tools/ask-user.js";
import {
  canPromptForQuestion,
  createExecAskUserBackend,
} from "./exec/questions.js";
import {
  ChatTurnSteeringController,
  createChatTurnSteeringIntervention,
} from "./chat/steering.js";
import { configure } from "./configure/index.js";
import { runAcpStdio } from "./acp/index.js";
import { main as daemon } from "./daemon/index.js";
import { createDaemonApprovalIntervention } from "./daemon/approvals.js";
import {
  flushAgentMemory,
  runWithAgentMemoryScope,
} from "./core/memory/index.js";
import { createSessionConfig } from "./core/session-config.js";
import { mcpJsonPath } from "./core/utils/paths.js";
import { getModeState, type SessionMode } from "./core/state/session-mode.js";
import { isYoloEnabled } from "./core/state/yolo.js";
import { formatModeNames, getModeIds } from "./core/modes/index.js";
import {
  latestCliSession,
  listCliSessions,
  type CliSessionSummary,
} from "./core/sessions/list-cli-sessions.js";
import { createRuntimeConfig } from "./core/runtime-config.js";

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

/**
 * Grace period after cleanup before the process is force-exited. Long enough for
 * buffered stdout/stderr to flush (e.g. when output is piped), short enough that
 * exit never feels like a hang.
 */
const FORCE_EXIT_GRACE_MS = 250;

/**
 * Ends the CLI with the given code. Prefers a natural event-loop drain, but if
 * lingering handles (commonly MCP HTTP/SSE keep-alive sockets or stdio children)
 * keep the loop alive, force-exits after a short grace period so shutdown never
 * hangs. The timer is unref'd so a clean run still exits immediately.
 */
function finalizeExit(code: number): void {
  process.exitCode = code;
  const timer = setTimeout(() => process.exit(code), FORCE_EXIT_GRACE_MS);
  timer.unref?.();
}

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

type CliChatFlags = CliAgentBootstrapFlags & {
  continue?: boolean;
};

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|authorization|cookie|accesskeyid|secretaccesskey|sessiontoken|headers|env|clientid|clientsecret)/i;

function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(() => REDACTED);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).map((key) => [
        key,
        REDACTED,
      ]),
    );
  }
  return REDACTED;
}

function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactCredentials(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, redactSensitiveValue(entry)];
      }
      return [key, redactCredentials(entry)];
    }),
  );
}

function formatSessionAge(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const deltaMs = Date.now() - date.getTime();
  if (!Number.isFinite(deltaMs)) {
    return "unknown";
  }
  if (deltaMs < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return date.toISOString().slice(0, 10);
}

function printSessionList(rows: CliSessionSummary[]): void {
  const headers = ["session", "updated", "title"] as const;
  const tableRows = rows.map((row) => ({
    session: row.sessionId,
    updated: formatSessionAge(row.updatedAt),
    title: row.title,
  }));
  const widths = headers.map((header) =>
    Math.max(
      header.length,
      ...tableRows.map((row) => row[header as keyof typeof row].length),
    ),
  );
  const formatColumns = (values: string[]): string =>
    values
      .map((value, index) => value.padEnd(widths[index] ?? value.length))
      .join("  ");

  console.log(formatColumns(headers.map((header) => header)));
  for (const row of tableRows) {
    console.log(formatColumns(headers.map((header) => row[header])));
  }
}

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
        mode: options.mode,
        interventions: [createToolApprovalIntervention()],
      },
      true,
    );
    if (canPromptForQuestion()) {
      setAskUserBackend(agent, createExecAskUserBackend());
    }
    try {
      await runWithAgentMemoryScope(agent, () => agent.invoke(prompt));
    } finally {
      try {
        await flushAgentMemory(agent);
      } catch {}
      try {
        await manager.disconnect();
      } catch {}
    }
    finalizeExit(0);
  });

program
  .command("chat")
  .description("Start an interactive, stateful CLI chat session.")
  .argument("[prompt]", "Optional initial prompt to run after startup.")
  .addOption(cliSessionIdOption())
  .addOption(cliSessionModeOption())
  .addOption(cliYoloOption("interactive"))
  .option("-C, --continue", "Resume the latest session in the current project.")
  .action(async (prompt: string | undefined, options: CliChatFlags) => {
    const config = createSessionConfig();
    const pinnedSession = options.session?.trim();
    const continuedSession = options.continue ? await latestCliSession() : null;
    let currentSessionId =
      pinnedSession || continuedSession?.sessionId || crypto.randomUUID();
    let currentPrompt = prompt?.trim() || undefined;
    let currentYolo = Boolean(options.yolo);
    let currentMode = options.mode as SessionMode;
    while (true) {
      const approvals = new ChatApprovalController();
      const questions = new ChatQuestionController();
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
          mode: currentMode,
          interventions: [
            createChatApprovalIntervention(approvals),
            createChatTurnSteeringIntervention(steering),
          ],
        },
        false,
        config,
      );
      setAskUserBackend(agent, createChatAskUserBackend(questions));

      try {
        const result = await chat({
          agent,
          config,
          manager,
          registry,
          sessionId: currentSessionId,
          prompt: currentPrompt,
          approvals,
          questions,
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
        if (result.nextAction === "resume" && result.resumeSessionId) {
          currentSessionId = result.resumeSessionId;
          currentPrompt = undefined;
          currentYolo = isYoloEnabled(agent);
          currentMode = getModeState(agent).mode;
          continue;
        }
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
    finalizeExit(0);
  });

const sessions = program
  .command("sessions")
  .description("List and inspect saved CLI sessions.");

sessions
  .command("list")
  .description("List saved sessions for the current project.")
  .action(async () => {
    const rows = await listCliSessions();
    if (rows.length === 0) {
      console.log("No saved sessions found.");
      return;
    }
    printSessionList(rows);
  });

program
  .command("config")
  .description(
    "Dump merged runtime config.json for this working directory with secrets redacted.",
  )
  .action(() => {
    const appConfig = createRuntimeConfig();
    const payload = {
      name: appConfig.name,
      providers: appConfig.providers,
      llms: appConfig.llms,
      search: appConfig.search,
      prompts: appConfig.prompts,
      tools: appConfig.tools,
      compaction: appConfig.compaction,
    };
    const redacted = redactCredentials(payload);
    console.log(JSON.stringify(redacted, null, 2));
  });

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
        mode: options.mode,
        createInterventions: ({ manager }) => [
          createDaemonApprovalIntervention(manager),
        ],
      },
      true,
    );
    try {
      await daemon({
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
    finalizeExit(0);
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
      finalizeExit(0);
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
        finalizeExit(0);
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
      finalizeExit(0);
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

// The Strands SDK's default logger uses `console.warn`/`console.error`. Ink's
// `render` patches `console.*` (patchConsole defaults to on), so those writes
// get captured and printed into the chat transcript. Writing straight to
// `process.stderr` bypasses that patch, keeping SDK diagnostics out of the TUI
// while still surfacing them on the error stream (and off stdout, which the ACP
// stdio protocol owns).
function writeStderr(prefix: string, args: unknown[]): void {
  const line = args
    .map((arg) =>
      typeof arg === "string"
        ? arg
        : arg instanceof Error
          ? (arg.stack ?? arg.message)
          : String(arg),
    )
    .join(" ");
  process.stderr.write(`${prefix} ${line}\n`);
}

configureLogging({
  debug: () => {},
  info: () => {},
  warn: (...args: unknown[]) => writeStderr("[strands:warn]", args),
  error: (...args: unknown[]) => writeStderr("[strands:error]", args),
});

const argv =
  process.argv.slice(2).length === 0 ? [...process.argv, "chat"] : process.argv;

await program.parseAsync(argv);
