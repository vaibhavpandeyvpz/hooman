import React, { useEffect, useMemo, useRef, useState } from "react";
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
  // `ink-select-input` resets its highlight to index 0 whenever the items' `value`
  // references change (it deep-compares them). Callers rebuild their item arrays
  // (with fresh closures) on every render, so without stabilizing the `value`
  // references, any state update — e.g. toggling an inline setting — would snap
  // the cursor back to the first item. We key a stable wrapper by each item's key
  // and always delegate to the latest closure.
  const valueMapRef = useRef(new Map<string, MenuAction>());
  const wrapperMapRef = useRef(new Map<string, MenuAction>());
  const keyedItems = useMemo(() => {
    const latestValues = new Map<string, MenuAction>();
    const mapped = items.map((item, index) => {
      const key = item.key ?? `${title ?? "menu"}:${index}:${item.label}`;
      latestValues.set(key, item.value);
      let wrapper = wrapperMapRef.current.get(key);
      if (!wrapper) {
        wrapper = () => valueMapRef.current.get(key)?.();
        wrapperMapRef.current.set(key, wrapper);
      }
      return { ...item, key, value: wrapper };
    });
    valueMapRef.current = latestValues;
    for (const key of [...wrapperMapRef.current.keys()]) {
      if (!latestValues.has(key)) {
        wrapperMapRef.current.delete(key);
      }
    }
    return mapped;
  }, [items, title]);
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
