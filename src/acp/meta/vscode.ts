/** Set on the ACP child process by the official Hooman VS Code extension. */
export const HOOMAN_X_VSCODE_ENV = "HOOMAN_X_VSCODE";

/**
 * Whether this ACP process was started by the official Hooman VS Code
 * extension (`HOOMAN_X_VSCODE=true` in the process environment).
 *
 * When true, sessions load the local MCP config (home `~/.hooman/mcp.json`
 * plus repo-local `.hooman/mcp.json` overlays) as usual, on top of any
 * session-scoped servers, instead of the default ACP isolation.
 */
export function isAcpVscodeHost(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[HOOMAN_X_VSCODE_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
