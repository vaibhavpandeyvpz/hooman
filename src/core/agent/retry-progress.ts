export type ModelRetryProgress = {
  status: "countdown" | "retrying";
  sessionId?: string;
  attempt: number;
  nextAttempt: number;
  maxAttempts: number;
  waitMs: number;
  retryInSeconds: number;
  error: string;
  errorDetail?: string;
};

export type ModelRetryProgressListener = (progress: ModelRetryProgress) => void;

const listeners = new Set<ModelRetryProgressListener>();

export function subscribeModelRetryProgress(
  listener: ModelRetryProgressListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitModelRetryProgress(progress: ModelRetryProgress): void {
  for (const listener of [...listeners]) {
    try {
      listener(progress);
    } catch {
      // A broken frontend listener must not fail the retry itself.
    }
  }
}
