import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { MenuAction, MenuItem } from "../types.js";
import { SelectMenuItem } from "./SelectMenuItem.js";

type MenuScreenProps = {
  title?: string;
  description?: string;
  items: MenuItem[];
  footerHint?: string;
};

export function MenuScreen({
  title,
  description,
  items,
  footerHint = "enter: select | esc: back | ctrl+c: exit",
}: MenuScreenProps): React.JSX.Element {
  const hasHeader = Boolean(title?.trim()) || Boolean(description?.trim());
  const keyedItems = items.map((item, index) => ({
    ...item,
    key: item.key ?? `${title ?? "menu"}:${index}:${item.label}`,
  }));

  return (
    <Box flexDirection="column" marginTop={1}>
      {title?.trim() ? <Text bold>{title}</Text> : null}
      {description ? <Text color="gray">{description}</Text> : null}
      <Box marginTop={hasHeader ? 1 : 0}>
        <SelectInput<MenuAction>
          items={keyedItems}
          itemComponent={SelectMenuItem}
          onSelect={(item) => {
            void item.value();
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">{footerHint}</Text>
      </Box>
    </Box>
  );
}
