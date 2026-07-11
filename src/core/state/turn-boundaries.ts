/**
 * Per-turn message-index bookmarks, keyed by the ACP `messageId` the agent
 * generates for that turn's user message.
 *
 * Per the ACP MessageId RFD, only the Agent generates protocol message ids —
 * a client never mints its own. Clients that support turn "revert"
 * capture the `messageId`
 * from the turn's `user_message_chunk` echo and pass it back via the custom
 * `_hoomanjs/rewind_session` method. We record `agent.messages.length` right
 * before the turn's messages are appended, so a later rewind can splice
 * history back to exactly that point. Stored on `appState` (persisted with
 * the snapshot) so it survives across turns within a session; entries are
 * dropped once their turn (or a later one) is rewound.
 */
export const TURN_BOUNDARIES_STATE_KEY = "hooman.turnBoundaries";

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

type TurnBoundaries = Record<string, number>;

function readTurnBoundaries(agent: AgentLike): TurnBoundaries {
  const raw = agent.appState.get<TurnBoundaries | undefined>(
    TURN_BOUNDARIES_STATE_KEY,
  );
  return raw && typeof raw === "object" ? raw : {};
}

/** Record the message-index boundary for a turn about to start. */
export function recordTurnBoundary(
  agent: AgentLike,
  messageId: string,
  messageIndex: number,
): void {
  const boundaries = readTurnBoundaries(agent);
  boundaries[messageId] = messageIndex;
  agent.appState.set(TURN_BOUNDARIES_STATE_KEY, boundaries);
}

/** Message-index boundary for `messageId`, or `undefined` if unknown (e.g. replayed history). */
export function getTurnBoundary(
  agent: AgentLike,
  messageId: string,
): number | undefined {
  return readTurnBoundaries(agent)[messageId];
}

/**
 * Drop the boundary for `messageId` and every turn recorded after it (their
 * messages are being spliced away by the rewind, so their bookmarks are no
 * longer meaningful).
 */
export function dropTurnBoundariesFrom(
  agent: AgentLike,
  messageId: string,
): void {
  const boundaries = readTurnBoundaries(agent);
  const cutoff = boundaries[messageId];
  if (cutoff === undefined) {
    return;
  }
  const next: TurnBoundaries = {};
  for (const [id, index] of Object.entries(boundaries)) {
    if (index < cutoff) {
      next[id] = index;
    }
  }
  agent.appState.set(TURN_BOUNDARIES_STATE_KEY, next);
}
