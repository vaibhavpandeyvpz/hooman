import { Box, Text } from "ink";
import { theme } from "../../core/theme.js";

export function Footer({
  showingDiagnostics,
}: {
  showingDiagnostics: boolean;
}) {
  return (
    <Box marginTop={1}>
      <Text color={theme.muted}>
        {"\u2191\u2193 select  \u2190\u2192 lane  L "}
        {showingDiagnostics ? "hide" : "show"}
        {" diagnostics  Q / Ctrl+C stop daemon"}
      </Text>
    </Box>
  );
}
