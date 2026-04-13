import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "../../chat/components/Spinner.tsx";

type BusyScreenProps = {
  message: string;
};

export function BusyScreen({ message }: BusyScreenProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Working</Text>
      <Box marginTop={1}>
        <Spinner type="dots" color="cyan" />
        <Text>{` ${message}`}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Please wait...</Text>
      </Box>
    </Box>
  );
}
