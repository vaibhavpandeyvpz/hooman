import React from "react";
import { Text } from "ink";

/** Custom row for `ink-select-input` so we can bold part of the label. */
export function SelectMenuItem(props: {
  isSelected?: boolean;
  label: string;
  boldSubstring?: string;
  oauthStatus?: "authenticated" | "expired" | "unauthenticated";
}): React.JSX.Element {
  const { isSelected, label, boldSubstring, oauthStatus } = props;
  const color = isSelected ? "blue" : undefined;
  const oauthMatch = label.match(/^(.*)( • oauth(?: needed)?)$/);
  const oauthSegment = oauthMatch?.[2];
  const baseLabel = oauthMatch?.[1] ?? label;

  const renderLabel = (text: string) => {
    if (!boldSubstring) {
      return text;
    }
    const i = text.indexOf(boldSubstring);
    if (i === -1) {
      return text;
    }
    const before = text.slice(0, i);
    const after = text.slice(i + boldSubstring.length);
    return (
      <>
        {before}
        <Text bold color={color}>
          {boldSubstring}
        </Text>
        {after}
      </>
    );
  };

  if (!boldSubstring) {
    return (
      <Text color={color}>
        {baseLabel}
        {oauthSegment ? (
          <Text color={oauthStatus === "authenticated" ? "green" : "red"}>
            {oauthSegment}
          </Text>
        ) : null}
      </Text>
    );
  }
  return (
    <Text color={color}>
      {renderLabel(baseLabel)}
      {oauthSegment ? (
        <Text color={oauthStatus === "authenticated" ? "green" : "red"}>
          {oauthSegment}
        </Text>
      ) : null}
    </Text>
  );
}
