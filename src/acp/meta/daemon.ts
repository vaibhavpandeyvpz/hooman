/** Set on the ACP child process spawned by Hooman's own daemon (`src/daemon`). */
export const HOOMAN_X_DAEMON_ENV = "HOOMAN_X_DAEMON";

/**
 * Whether this ACP process was started by Hooman's own daemon
 * (`HOOMAN_X_DAEMON=true` in the process environment).
 *
 * Selects the daemon system prompt/mode for every session on this process.
 * MCP tools still come exclusively from the session-scoped `mcpServers` the
 * daemon supplies (its local aggregate tool proxy) — this flag never enables
 * local `mcp.json` loading, unlike {@link isAcpVscodeHost}.
 */
export function isAcpDaemonHost(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[HOOMAN_X_DAEMON_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
