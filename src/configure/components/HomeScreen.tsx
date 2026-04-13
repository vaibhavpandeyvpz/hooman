import React from "react";
import { Box, Text } from "ink";
import type { MenuItem } from "../types.ts";
import { MenuScreen } from "./MenuScreen.tsx";

type HomeScreenProps = {
  rootPath: string;
  configPath: string;
  instructionsPath: string;
  mcpPath: string;
  skillsPath: string;
  items: MenuItem[];
};

export function HomeScreen({
  rootPath,
  configPath,
  instructionsPath,
  mcpPath,
  skillsPath,
  items,
}: HomeScreenProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">
        <Text bold>root:</Text> {rootPath}
      </Text>
      <Text color="gray">
        <Text bold>config.json:</Text> {configPath}
      </Text>
      <Text color="gray">
        <Text bold>instructions.md:</Text> {instructionsPath}
      </Text>
      <Text color="gray">
        <Text bold>mcp.json:</Text> {mcpPath}
      </Text>
      <Text color="gray">
        <Text bold>skills/:</Text> {skillsPath}
      </Text>
      <MenuScreen items={items} footerHint="enter: select | ctrl+c: exit" />
    </Box>
  );
}
