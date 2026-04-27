import React from "react";
import { Box, Text, useWindowSize } from "ink";
import { ASCII_ART } from "./ascii-logo.js";

export function EmptyChatBanner(): React.JSX.Element {
  const { columns } = useWindowSize();

  return (
    <Box flexDirection="column" width={columns}>
      <Box
        width={columns}
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
