import { Box, Text } from "ink";
import { theme } from "../../core/theme.js";
import type { DaemonSessionCard } from "../dashboard/types.js";
import { Card } from "./Card.js";

export type LaneProps = {
  title: string;
  cards: DaemonSessionCard[];
  now: number;
  width: number;
  maxVisible: number;
  selectedKey: string | undefined;
  accent: string;
};

export function Lane({
  title,
  cards,
  now,
  width,
  maxVisible,
  selectedKey,
  accent,
}: LaneProps) {
  const visible = cards.slice(0, maxVisible);
  const hidden = cards.length - visible.length;
  return (
    <Box flexDirection="column" width={width}>
      <Text bold color={accent}>
        {`${title} \u00b7 ${cards.length}`}
      </Text>
      {visible.length === 0 ? (
        <Text color={theme.muted}>none</Text>
      ) : (
        visible.map((card) => (
          <Card
            key={card.externalKey + (card.disposedAt ?? "")}
            card={card}
            now={now}
            width={width - 1}
            selected={card.externalKey === selectedKey}
          />
        ))
      )}
      {hidden > 0 ? <Text color={theme.muted}>+{hidden} more</Text> : null}
    </Box>
  );
}
