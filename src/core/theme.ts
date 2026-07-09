/**
 * Shared brand palette for CLI Ink surfaces (and any other non-webview UI).
 * VS Code webviews mirror these values in `src/vscode/webview/index.css`.
 */
export const theme = {
  primary: "#0091cd",
  secondary: "#56a0d3",
  warning: "#ecb731",
  error: "#ee4c58",
  success: "#8ec06c",
  info: "#c4dff6",
  muted: "#9ba5a8",
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
