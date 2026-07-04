/**
 * Whether the ACP client identified itself as the official Hooman VS Code
 * extension via `_meta["hoomanjs/vscode"]: true` on `session/new`,
 * `session/load`, or `session/resume`.
 *
 * Sessions from the official extension load the local MCP config (home
 * `~/.hooman/mcp.json` plus repo-local `.hooman/mcp.json` overlays) as usual,
 * on top of any session-scoped servers, instead of the default ACP isolation.
 */
export function extractAcpVscodeFlag(_meta: unknown): boolean {
  if (!_meta || typeof _meta !== "object") {
    return false;
  }
  return (_meta as Record<string, unknown>)["hoomanjs/vscode"] === true;
}
