import React from "react";
import { Text } from "ink";

/** Custom row for `ink-select-input` so we can bold part of the label. */
export function SelectMenuItem(props: {
  isSelected?: boolean;
  label: string;
  boldSubstring?: string;
}): React.JSX.Element {
  const { isSelected, label, boldSubstring } = props;
  const color = isSelected ? "blue" : undefined;
  if (!boldSubstring) {
    return <Text color={color}>{label}</Text>;
  }
  const i = label.indexOf(boldSubstring);
  if (i === -1) {
    return <Text color={color}>{label}</Text>;
  }
  const before = label.slice(0, i);
  const after = label.slice(i + boldSubstring.length);
  return (
    <Text color={color}>
      {before}
      <Text bold color={color}>
        {boldSubstring}
      </Text>
      {after}
    </Text>
  );
}
