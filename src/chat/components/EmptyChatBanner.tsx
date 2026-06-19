import React from "react";
import { Box, Text } from "ink";
import { ASCII_ART } from "./ascii-logo.js";

export function EmptyChatBanner(): React.JSX.Element {
  return (
    <Box flexDirection="column" width="100%">
      <Box
        width="100%"
        flexDirection="row"
        justifyContent="center"
        paddingY={2}
      >
        <Box flexDirection="column">
          {ASCII_ART.map((line, i) => (
            <Text key={i} color="cyan" bold>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
