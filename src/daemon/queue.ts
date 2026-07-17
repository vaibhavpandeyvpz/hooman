/**
 * Serializes turns per external conversation key while allowing unrelated
 * keys to run fully concurrently — replaces the old single global-concurrency
 * queue now that many ACP sessions may be active at once.
 */
export class KeyedTurnQueue {
  #tails = new Map<string, { length: number; tail: Promise<void> }>();

  /** Number of tasks currently queued (including the one running, if any) for `key`. */
  public length(key: string): number {
    return this.#tails.get(key)?.length ?? 0;
  }

  /** Enqueues `task` behind any already-running/queued task for the same `key`. */
  public push(key: string, task: () => Promise<void>): void {
    const state = this.#tails.get(key) ?? {
      length: 0,
      tail: Promise.resolve(),
    };
    state.length += 1;
    this.#tails.set(key, state);
    // Swallow task rejections here: `state.tail` is chained with `.then()`,
    // so a rejected tail would skip every subsequent `.then()` callback for
    // this key, permanently poisoning the queue instead of just failing one
    // turn. Callers that care about per-task failure (e.g. `runTurn`) already
    // catch their own errors; this is a backstop against anything that slips
    // past that.
    state.tail = state.tail.then(async () => {
      try {
        await task();
      } catch {
        /* ignore: never poison the chain for this key */
      } finally {
        state.length -= 1;
        if (state.length === 0) {
          this.#tails.delete(key);
        }
      }
    });
  }

  /** Waits for every currently queued task (across every key) to settle. */
  public async drain(): Promise<void> {
    await Promise.allSettled([...this.#tails.values()].map((s) => s.tail));
  }
}
