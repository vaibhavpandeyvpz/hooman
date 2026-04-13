import { Agent, SummarizingConversationManager } from "@strands-agents/sdk";
import { SessionManager, FileStorage } from "@strands-agents/sdk";
import { sessionsPath } from "../../utils/paths";

export function create(sessionId: string) {
  const sessionManager = new SessionManager({
    sessionId,
    storage: { snapshot: new FileStorage(sessionsPath()) },
  });

  const conversationManager = new SummarizingConversationManager({
    summaryRatio: 0.5,
    preserveRecentMessages: 5,
  });

  return { sessionManager, conversationManager };
}
