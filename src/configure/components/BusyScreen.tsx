import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "../../chat/components/Spinner.js";
import { theme } from "../../core/theme.js";

type BusyScreenProps = {
  message: string;
};

export function BusyScreen({ message }: BusyScreenProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Working</Text>
      <Box marginTop={1}>
        <Spinner type="dots" color={theme.primary} />
        <Text>{` ${message}`}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>Please wait...</Text>
      </Box>
    </Box>
  );
}
