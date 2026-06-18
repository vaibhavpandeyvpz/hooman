import {
  IntervalTrigger,
  ModelExtractor,
  SessionManager,
  SummarizingConversationManager,
} from "@strands-agents/sdk";
import { ContextInjector } from "@strands-agents/sdk/vended-plugins/context-injector";
import {
  ContextOffloader,
  FileStorage,
} from "@strands-agents/sdk/vended-plugins/context-offloader";
import { join } from "node:path";
import { FileMemoryStore } from "../memory/index.js";
import { readBundledPrompt } from "../prompts/bundled.js";
import { memoryPath, sessionsPath } from "../utils/paths.js";
import { FlatFileStorage } from "./flat-file-storage.js";
import { LazySessionManager } from "./lazy-session-manager.js";

const OFFLOADED_CONTENT_DIR = "offloaded-content";
const OFFLOADING_MAX_RESULT_TOKENS = 5_000;
const OFFLOADING_PREVIEW_TOKENS = 2_000;

const MEMORY_STORE_NAME = "long_term";
const MEMORY_EXTRACTION_TURNS = 5;
const MEMORY_MAX_SEARCH_RESULTS = 5;
const MEMORY_EXTRACTION_PROMPT = readBundledPrompt("static", "memory.md");

export function create(sessionId?: string) {
  const conversationManager = new SummarizingConversationManager({
    summaryRatio: 0.5,
    preserveRecentMessages: 5,
  });
  const storage = new FlatFileStorage(sessionsPath());
  const offloadingPlugins = createOffloadingPlugins();
  const memoryManager = createMemoryManager();

  if (!sessionId) {
    return {
      plugins: [...offloadingPlugins, new LazySessionManager({ storage })],
      conversationManager,
      memoryManager,
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
    memoryManager,
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
      storage: new FileStorage(join(sessionsPath(), OFFLOADED_CONTENT_DIR)),
      maxResultTokens: OFFLOADING_MAX_RESULT_TOKENS,
      previewTokens: OFFLOADING_PREVIEW_TOKENS,
      includeRetrievalTool: true,
    }),
  ];
}

function createMemoryManager() {
  const store = new FileMemoryStore({
    baseDir: memoryPath(),
    name: MEMORY_STORE_NAME,
    description:
      "Durable facts, preferences, recurring tasks, and stable context learned about the current user across sessions.",
    maxSearchResults: MEMORY_MAX_SEARCH_RESULTS,
    writable: true,
    extraction: {
      trigger: new IntervalTrigger({ turns: MEMORY_EXTRACTION_TURNS }),
      extractor: new ModelExtractor({
        systemPrompt: MEMORY_EXTRACTION_PROMPT,
      }),
    },
  });

  return {
    stores: [store],
  };
}

export { LazySessionManager } from "./lazy-session-manager.js";
export type { LazySessionManagerConfig } from "./lazy-session-manager.js";
