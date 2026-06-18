import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { MenuAction, MenuItem } from "../types.js";
import { SelectMenuItem } from "./SelectMenuItem.js";

type MenuScreenProps = {
  title?: string;
  description?: string;
  items: MenuItem[];
  footerHint?: string | ((item: MenuItem | undefined) => string);
  initialIndex?: number;
  onShortcut?: (
    input: string,
    item: MenuItem | undefined,
  ) => void | Promise<void>;
};

export function MenuScreen({
  title,
  description,
  items,
  footerHint = "enter: select | esc: back | ctrl+c: exit",
  initialIndex = 0,
  onShortcut,
}: MenuScreenProps): React.JSX.Element {
  const hasHeader = Boolean(title?.trim()) || Boolean(description?.trim());
  const keyedItems = useMemo(
    () =>
      items.map((item, index) => ({
        ...item,
        key: item.key ?? `${title ?? "menu"}:${index}:${item.label}`,
      })),
    [items, title],
  );
  const [highlightedKey, setHighlightedKey] = useState<string | undefined>(
    keyedItems[Math.max(0, Math.min(initialIndex, keyedItems.length - 1))]?.key,
  );

  useEffect(() => {
    if (keyedItems.length === 0) {
      setHighlightedKey(undefined);
      return;
    }
    if (
      highlightedKey &&
      keyedItems.some((item) => item.key === highlightedKey)
    ) {
      return;
    }
    setHighlightedKey(
      keyedItems[Math.max(0, Math.min(initialIndex, keyedItems.length - 1))]
        ?.key,
    );
  }, [highlightedKey, initialIndex, keyedItems]);

  const highlightedItem = keyedItems.find(
    (item) => item.key === highlightedKey,
  );
  const resolvedFooterHint =
    typeof footerHint === "function" ? footerHint(highlightedItem) : footerHint;

  useInput((input, key) => {
    if (key.ctrl || key.escape || key.return || key.upArrow || key.downArrow) {
      return;
    }
    if (!input) {
      return;
    }
    void onShortcut?.(input, highlightedItem);
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {title?.trim() ? <Text bold>{title}</Text> : null}
      {description ? <Text color="gray">{description}</Text> : null}
      <Box marginTop={hasHeader ? 1 : 0}>
        <SelectInput<MenuAction>
          items={keyedItems}
          initialIndex={initialIndex}
          itemComponent={SelectMenuItem}
          onSelect={(item) => {
            void item.value();
          }}
          onHighlight={(item) => {
            setHighlightedKey(item.key);
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">{resolvedFooterHint}</Text>
      </Box>
    </Box>
  );
}
