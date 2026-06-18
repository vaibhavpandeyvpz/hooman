import {
  SessionManager,
  SummarizingConversationManager,
} from "@strands-agents/sdk";
import { ContextInjector } from "@strands-agents/sdk/vended-plugins/context-injector";
import {
  ContextOffloader,
  FileStorage,
} from "@strands-agents/sdk/vended-plugins/context-offloader";
import { join } from "node:path";
import { sessionsPath } from "../utils/paths.js";
import { FlatFileStorage } from "./flat-file-storage.js";
import { LazySessionManager } from "./lazy-session-manager.js";

const OFFLOADED_CONTENT_DIR = "offloaded-content";
const OFFLOADING_MAX_RESULT_TOKENS = 5_000;
const OFFLOADING_PREVIEW_TOKENS = 2_000;

export function create(sessionId?: string) {
  const conversationManager = new SummarizingConversationManager({
    summaryRatio: 0.5,
    preserveRecentMessages: 5,
  });
  const storage = new FlatFileStorage(sessionsPath());
  const offloadingPlugins = createOffloadingPlugins();

  if (!sessionId) {
    return {
      plugins: [...offloadingPlugins, new LazySessionManager({ storage })],
      conversationManager,
    };
  }

  const sessionManager = new SessionManager({
    sessionId,
    storage: { snapshot: storage },
  });

  return {
    plugins: offloadingPlugins,
    sessionManager,
    conversationManager,
  };
}

function createOffloadingPlugins() {
  return [
    new ContextInjector({
      name: "clock",
      trigger: "everyTurn",
      renderContent: async () => `<now>${new Date().toISOString()}</now>`,
    }),
    new ContextOffloader({
      storage: new FileStorage(
        join(sessionsPath(), OFFLOADED_CONTENT_DIR),
      ),
      maxResultTokens: OFFLOADING_MAX_RESULT_TOKENS,
      previewTokens: OFFLOADING_PREVIEW_TOKENS,
      includeRetrievalTool: true,
    }),
  ];
}

export { LazySessionManager } from "./lazy-session-manager.js";
export type { LazySessionManagerConfig } from "./lazy-session-manager.js";
