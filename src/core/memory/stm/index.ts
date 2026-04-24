import {
  SessionManager,
  SummarizingConversationManager,
} from "@strands-agents/sdk";
import { sessionsPath } from "../../utils/paths";
import { FlatFileStorage } from "./flat-file-storage";
import { LazySessionManager } from "./lazy-session-manager";

export function create(sessionId?: string) {
  const conversationManager = new SummarizingConversationManager({
    summaryRatio: 0.5,
    preserveRecentMessages: 5,
  });
  const storage = new FlatFileStorage(sessionsPath());

  if (!sessionId) {
    return {
      plugins: [new LazySessionManager({ storage })],
      conversationManager,
    };
  }

  const sessionManager = new SessionManager({
    sessionId,
    storage: { snapshot: storage },
  });

  return { sessionManager, conversationManager };
}

export { LazySessionManager } from "./lazy-session-manager";
export type { LazySessionManagerConfig } from "./lazy-session-manager";
