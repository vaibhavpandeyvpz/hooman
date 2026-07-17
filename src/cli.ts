#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { bootstrap } from "./core/index.js";
import { createMcpManager } from "./core/mcp/index.js";
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
  createOsBrowserPreviewBackend,
  setBrowserPreviewBackend,
} from "./core/utils/browser.js";
import {
  canPromptForQuestion,
  createExecAskUserBackend,
} from "./exec/questions.js";
import {
  ChatTurnSteeringController,
  createChatTurnSteeringIntervention,
} from "./chat/steering.js";
import { configure } from "./configure/index.js";
import { onboard } from "./onboarding/index.js";
import { runAcpStdio } from "./acp/index.js";
import { main as daemon, type DaemonCliOverrides } from "./daemon/index.js";
import { AcpDaemonClient } from "./daemon/acp-client.js";
import { createDaemonPermissionHandler } from "./daemon/approvals.js";
import { DaemonDashboardStore } from "./daemon/dashboard/store.js";
import { startDaemonMcpProxy } from "./daemon/mcproxy/index.js";
import { DaemonSessionRegistry } from "./daemon/session-registry.js";
import { launchDaemonDashboard } from "./daemon/ui/index.js";
import {
  flushAgentMemory,
  runWithAgentMemoryScope,
} from "./core/memory/index.js";
import { createSessionConfig } from "./core/session-config.js";
import { getModeState, type SessionMode } from "./core/state/session-mode.js";
import { isYoloEnabled } from "./core/state/yolo.js";
import { formatModeNames, getModeIds } from "./core/modes/index.js";
import {
  latestCliSession,
  listCliSessions,
  type CliSessionSummary,
} from "./core/sessions/list-cli-sessions.js";
import {
  createRuntimeConfig,
  createRuntimeMcpConfig,
} from "./core/runtime-config.js";
import { hasOnboardingConfig } from "./core/utils/onboarding-config.js";
import {
  createModelDownloadLogger,
  subscribeModelDownloadProgress,
} from "./core/utils/download-progress.js";
import {
  patchSdkLogger,
  quietChatLogs,
  redirectLogs,
} from "./core/utils/logging.js";
import {
  activeProviderName,
  parseReasoningEffortArg,
  REASONING_EFFORT_LEVELS,
  REASONING_EFFORT_OFF,
  withReasoningEffort,
} from "./core/utils/reasoning-effort.js";
import type { SessionConfig } from "./core/session-config.js";

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

function cliContinueOption(): Option {
  return new Option(
    "-C, --continue",
    "Resume the latest session in the current project.",
  );
}

function cliSessionModeOption(): Option {
  return new Option(
    "-m, --mode <mode>",
    `Session mode: ${formatModeNames()}. Agent is the full tool surface; ask is read-oriented; plan is the plan-file workflow; design is HTML artifacts under .hooman/design.`,
  )
    .choices(getModeIds())
    .default("agent");
}

function cliEffortOption(): Option {
  return new Option(
    "--effort <level>",
    "Reasoning effort for the active model provider.",
  ).choices([...REASONING_EFFORT_LEVELS, REASONING_EFFORT_OFF]);
}

function cliModelOption(): Option {
  return new Option(
    "--model <name>",
    "Named LLM from config.json to use for this run.",
  );
}

function cliYoloOption(kind: "interactive" | "daemon"): Option {
  const description =
    kind === "daemon"
      ? "Allow all tools without remote approval or prompts."
      : "Allow all tools without prompting for approval.";
  return new Option("--yolo", description);
}

/** Attach the shared agent-bootstrap flags used by exec, chat, and daemon. */
function addCliAgentBootstrapOptions(
  command: Command,
  kind: "interactive" | "daemon",
): Command {
  return command
    .addOption(cliSessionIdOption())
    .addOption(cliContinueOption())
    .addOption(cliSessionModeOption())
    .addOption(cliEffortOption())
    .addOption(cliModelOption())
    .addOption(cliYoloOption(kind));
}

type CliSessionModeOption = {
  mode: string;
};

/** Shared flags on commands that bootstrap an agent (exec, chat, daemon). */
type CliAgentBootstrapFlags = CliSessionModeOption & {
  session?: string;
  continue?: boolean;
  effort?: string;
  model?: string;
  yolo?: boolean;
};

async function resolveCliSessionId(
  options: Pick<CliAgentBootstrapFlags, "session" | "continue">,
): Promise<string | undefined> {
  const pinned = options.session?.trim();
  if (pinned) {
    return pinned;
  }
  if (options.continue) {
    return (await latestCliSession())?.sessionId;
  }
  return undefined;
}

/**
 * Apply `--model` / `--effort` to a session config before bootstrap. Model is
 * applied first so effort targets the selected provider. Matches chat `/model`
 * and `/effort` persistence rules (base-config entries only).
 */
function applyCliModelAndEffort(
  config: SessionConfig,
  options: Pick<CliAgentBootstrapFlags, "model" | "effort">,
): void {
  const modelName = options.model?.trim();
  if (modelName) {
    const match = config.llms.find((entry) => entry.name === modelName);
    if (!match) {
      const available = config.llms.map((entry) => entry.name).join(", ");
      throw new Error(
        `Unknown model "${modelName}". Configured models: ${available || "(none)"}.`,
      );
    }
    config.update({
      llms: config.llms.map((entry) => ({
        ...entry,
        default: entry.name === match.name,
      })),
    });
    config.persistToDisk((base) =>
      base.llms.some((entry) => entry.name === match.name)
        ? {
            llms: base.llms.map((entry) => ({
              ...entry,
              default: entry.name === match.name,
            })),
          }
        : null,
    );
  }

  if (options.effort === undefined) {
    return;
  }
  const parsed = parseReasoningEffortArg(options.effort);
  if (!parsed) {
    throw new Error(
      `Unknown reasoning effort "${options.effort}". Use off, minimal, low, medium, or high.`,
    );
  }
  const providerName = activeProviderName(config);
  if (!providerName) {
    throw new Error("No active model provider to set reasoning effort on.");
  }
  config.update({
    providers: config.providers.map((entry) =>
      entry.name === providerName
        ? {
            ...entry,
            options: withReasoningEffort(entry.options, parsed.value),
          }
        : entry,
    ) as typeof config.providers,
  });
  config.persistToDisk((base) =>
    base.providers.some((entry) => entry.name === providerName)
      ? {
          providers: base.providers.map((entry) =>
            entry.name === providerName
              ? {
                  ...entry,
                  options: withReasoningEffort(entry.options, parsed.value),
                }
              : entry,
          ) as typeof base.providers,
        }
      : null,
  );
}

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

const execCommand = program
  .command("exec")
  .description("Bootstrap an agent and run a single prompt.")
  .argument("<prompt>", "Prompt to run once.");
addCliAgentBootstrapOptions(execCommand, "interactive").action(
  async (prompt: string, options: CliAgentBootstrapFlags) => {
    // Keep third-party `console.*` chatter (e.g. the Hugging Face Hub's
    // "Downloading …" lines) off stdout, which carries the agent output.
    redirectLogs();
    const config = createSessionConfig();
    applyCliModelAndEffort(config, options);
    const sessionId =
      (await resolveCliSessionId(options)) || crypto.randomUUID();
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
      config,
    );
    if (canPromptForQuestion()) {
      setAskUserBackend(agent, createExecAskUserBackend());
    }
    setBrowserPreviewBackend(agent, createOsBrowserPreviewBackend());
    // Model weights download progress (llama.cpp GGUF fetch on first use):
    // live single-line updates on a TTY, coarse log lines when piped.
    const stopDownloadProgress = subscribeModelDownloadProgress(
      createModelDownloadLogger({ stream: process.stderr }),
    );
    try {
      await runWithAgentMemoryScope(agent, () => agent.invoke(prompt));
    } finally {
      stopDownloadProgress();
      try {
        await flushAgentMemory(agent);
      } catch {}
      try {
        await manager.disconnect();
      } catch {}
    }
    finalizeExit(0);
  },
);

const chatCommand = program
  .command("chat")
  .description("Start an interactive, stateful CLI chat session.")
  .argument("[prompt]", "Optional initial prompt to run after startup.");
addCliAgentBootstrapOptions(chatCommand, "interactive").action(
  async (prompt: string | undefined, options: CliAgentBootstrapFlags) => {
    // Ink owns stdout: drop console/SDK chatter instead of redirecting it —
    // raw stderr writes would garble the live frame (see quietChatLogs).
    quietChatLogs();
    const config = createSessionConfig();
    applyCliModelAndEffort(config, options);
    let currentSessionId =
      (await resolveCliSessionId(options)) || crypto.randomUUID();
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
      setBrowserPreviewBackend(agent, createOsBrowserPreviewBackend());

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
  },
);
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
    "Open the interactive configuration UI, or dump redacted runtime config with --debug.",
  )
  .option(
    "-d, --debug",
    "Dump merged runtime config.json for this working directory with secrets redacted.",
  )
  .action(async (options: { debug?: boolean }) => {
    if (options.debug) {
      const appConfig = createRuntimeConfig();
      const payload = {
        name: appConfig.name,
        providers: appConfig.providers,
        llms: appConfig.llms,
        search: appConfig.search,
        prompts: appConfig.prompts,
        tools: appConfig.tools,
        compaction: appConfig.compaction,
        daemon: appConfig.daemon,
      };
      const redacted = redactCredentials(payload);
      console.log(JSON.stringify(redacted, null, 2));
      return;
    }
    quietChatLogs();
    await configure();
    finalizeExit(0);
  });

program
  .command("setup")
  .description(
    "Run first-run setup to create ~/.hooman/config.json (inference + search).",
  )
  .action(async () => {
    quietChatLogs();
    const ok = await onboard();
    finalizeExit(ok ? 0 : 1);
  });

type DaemonCliFlags = CliSessionModeOption & {
  session?: string;
  effort?: string;
  model?: string;
  yolo?: boolean;
  sessionIdle?: string;
  maxActiveSessions?: string;
  mcpProxyPort?: string;
  debug?: boolean;
  dashboard?: boolean;
};

/** Parses a daemon numeric CLI override, throwing on a non-finite/negative value. */
function parseDaemonNonNegativeInt(raw: string, flag: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${flag} "${raw}": expected a non-negative integer.`,
    );
  }
  return parsed;
}

const daemonCommand = program
  .command("daemon")
  .description(
    "Run a background daemon that multiplexes MCP channel notifications across ACP sessions.",
  );
daemonCommand
  .addOption(cliSessionIdOption())
  .addOption(cliSessionModeOption())
  .addOption(cliEffortOption())
  .addOption(cliModelOption())
  .addOption(cliYoloOption("daemon"))
  .option(
    "--session-idle <seconds>",
    "Idle seconds before an inactive ACP session closes (0 disables ordinary idle close; pool pressure still evicts).",
  )
  .option(
    "--max-active-sessions <count>",
    "Maximum number of concurrently active ACP sessions.",
  )
  .option(
    "--mcp-proxy-port <port>",
    "Fixed port for the local MCP tool proxy (default: ephemeral).",
  )
  .option(
    "--debug",
    "Log each MCP channel notification payload to the console.",
  )
  .option(
    "--no-dashboard",
    "Disable the interactive terminal dashboard and use plain log output.",
  )
  .action(async (options: DaemonCliFlags) => {
    const useDashboard =
      options.dashboard !== false && Boolean(process.stdout.isTTY);
    // Same as `exec`: console chatter joins the daemon's stderr diagnostics.
    // In dashboard mode raw stderr writes would garble the Ink frame, so
    // diagnostics route into the dashboard's drawer instead (wired below).
    if (!useDashboard) {
      redirectLogs();
    }
    const config = createSessionConfig();
    applyCliModelAndEffort(config, options);

    const sessionIdleTimeoutMs =
      options.sessionIdle !== undefined
        ? parseDaemonNonNegativeInt(options.sessionIdle, "--session-idle") *
          1000
        : config.daemon.sessions.timeout;
    const maxActiveSessions =
      options.maxActiveSessions !== undefined
        ? parseDaemonNonNegativeInt(
            options.maxActiveSessions,
            "--max-active-sessions",
          )
        : config.daemon.sessions.max;
    if (maxActiveSessions < 1) {
      throw new Error("--max-active-sessions must be at least 1.");
    }
    const mcpProxyPort =
      options.mcpProxyPort !== undefined
        ? parseDaemonNonNegativeInt(options.mcpProxyPort, "--mcp-proxy-port")
        : (config.daemon.mcproxy.port ?? 0);

    const cliOverrides: DaemonCliOverrides = {
      mode: options.mode,
      model: options.model,
      effort: options.effort,
      yolo: options.yolo,
    };

    const dashboard = useDashboard ? new DaemonDashboardStore() : undefined;
    dashboard?.setPoolMax(maxActiveSessions);

    const manager = createMcpManager(createRuntimeMcpConfig());
    let acpClient!: AcpDaemonClient;
    const registry = new DaemonSessionRegistry({
      maxActiveSessions,
      idleTimeoutMs: sessionIdleTimeoutMs,
      onClose: async (_externalKey, acpSessionId) => {
        try {
          await acpClient.closeSession(acpSessionId);
        } catch {}
      },
      onEvent: dashboard
        ? (event) => {
            dashboard.setPoolStats(registry.poolStats());
            switch (event.type) {
              case "slot_waiting":
                dashboard.onWaitingSlot(event.externalKey);
                break;
              case "idle":
                dashboard.onIdle(event.externalKey);
                break;
              case "disposed":
                dashboard.onDisposed(event.externalKey, event.reason);
                break;
              default:
                break;
            }
          }
        : undefined,
    });
    await registry.hydrate();

    const dashboardHandle = dashboard
      ? launchDaemonDashboard(dashboard, () => {
          // Simulates the same SIGINT the terminal would send on Ctrl+C, so
          // the dashboard's `q`/Ctrl+C key drives the exact shutdown path
          // `daemon()`'s stopper promise already listens for.
          process.kill(process.pid, "SIGINT");
        })
      : undefined;
    const mcpRefreshTimer = dashboard
      ? setInterval(
          () => dashboard.setMcpServerCount(manager.clients.size),
          2000,
        )
      : undefined;
    mcpRefreshTimer?.unref?.();

    try {
      const proxy = await startDaemonMcpProxy(manager, { port: mcpProxyPort });
      acpClient = new AcpDaemonClient({
        cliPath: fileURLToPath(import.meta.url),
        cwd: process.cwd(),
        onPermissionRequest: createDaemonPermissionHandler(manager, registry),
        onSessionUpdate: (notification) => {
          if (!dashboard) {
            return;
          }
          const externalKey = registry.externalKeyForAcpSession(
            notification.sessionId,
          );
          if (externalKey) {
            dashboard.onAcpUpdate(externalKey, notification);
          }
        },
        onChildStderr: (line) => {
          if (dashboard) {
            dashboard.addDiagnostic(`[acp] ${line}`);
          } else {
            process.stderr.write(`[daemon:acp] ${line}\n`);
          }
        },
        onChildConnected: () => dashboard?.setAcpChildState("connected"),
        onChildExit: () => {
          dashboard?.setAcpChildState("reconnecting");
          registry.invalidateRuntimes();
        },
      });
      try {
        await daemon({
          manager,
          acpClient,
          registry,
          mcpServer: proxy.mcpServer,
          cwd: process.cwd(),
          session: options.session,
          cliOverrides,
          debug: Boolean(options.debug),
          dashboard,
        });
      } finally {
        await acpClient.close();
        await proxy.close();
      }
    } finally {
      if (mcpRefreshTimer) {
        clearInterval(mcpRefreshTimer);
      }
      dashboardHandle?.stop();
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
    const manager = createMcpManager(createRuntimeMcpConfig());
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
      const manager = createMcpManager(createRuntimeMcpConfig());
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
  .command("status")
  .description("Show OAuth status for configured MCP servers.")
  .action(async () => {
    const manager = createMcpManager(createRuntimeMcpConfig());
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
    // stdout *is* the JSON-RPC channel: any stray `console.*` write would
    // corrupt the protocol stream, so everything goes to stderr.
    redirectLogs();
    await runAcpStdio();
  });

// Default Strands SDK logger for every command (warn+ on stderr); the
// commands above additionally re-route or silence global `console` output
// per surface — utility commands (sessions/config --debug/mcp) keep stdout intact.
patchSdkLogger();

// No args: first-run onboarding when config.json is missing, otherwise chat.
if (process.argv.slice(2).length === 0) {
  if (!hasOnboardingConfig()) {
    quietChatLogs();
    if (!(await onboard())) {
      finalizeExit(1);
    } else {
      await program.parseAsync([...process.argv, "chat"]);
    }
  } else {
    await program.parseAsync([...process.argv, "chat"]);
  }
} else {
  await program.parseAsync(process.argv);
}
