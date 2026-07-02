import type { Config } from "../config.js";

/**
 * Shared reasoning-effort helpers used by both the chat TUI and the ACP agent
 * so the two front-ends cycle/set/persist effort identically.
 *
 * Effort is stored under a provider's `options.reasoning.effort`. Its presence
 * enables thinking; the level is forwarded where the backend supports it. The
 * `undefined` rung means "off" (no reasoning), so a single control can also
 * disable thinking.
 */

/**
 * Ordered effort rungs cycled by the chat Shift+Tab shortcut and `/effort`.
 * `undefined` is the "off" (no reasoning) rung.
 */
export const REASONING_EFFORT_CYCLE = [
  undefined,
  "minimal",
  "low",
  "medium",
  "high",
] as const;

/** Selectable effort levels (the {@link REASONING_EFFORT_CYCLE} minus "off"). */
export const REASONING_EFFORT_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
] as const;

/** Sentinel value used to represent the "off" rung in pickers/config options. */
export const REASONING_EFFORT_OFF = "off";

/** Advance one rung through {@link REASONING_EFFORT_CYCLE}, wrapping around. */
export function nextReasoningEffort(
  current: string | undefined,
  direction: 1 | -1,
): string | undefined {
  const currentIndex = REASONING_EFFORT_CYCLE.indexOf(
    (current ?? undefined) as (typeof REASONING_EFFORT_CYCLE)[number],
  );
  const from = currentIndex === -1 ? 0 : currentIndex;
  const length = REASONING_EFFORT_CYCLE.length;
  const nextIndex = (from + direction + length) % length;
  return REASONING_EFFORT_CYCLE[nextIndex];
}

/**
 * Returns provider options with `reasoning.effort` set to `nextEffort`,
 * preserving sibling reasoning keys and collapsing to `undefined` when the
 * reasoning object would end up empty (so we never persist `"reasoning": {}`).
 */
export function withReasoningEffort(
  options: unknown,
  nextEffort: string | undefined,
): Record<string, unknown> {
  const base = (options ?? {}) as Record<string, unknown>;
  const reasoning = base.reasoning as Record<string, unknown> | undefined;
  const merged = { ...(reasoning ?? {}), effort: nextEffort };
  const hasValues = Object.values(merged).some((value) => value !== undefined);
  return { ...base, reasoning: hasValues ? merged : undefined };
}

/** Read `reasoning.effort` out of a provider's raw options object. */
export function readProviderEffort(options: unknown): string | undefined {
  const reasoning = (options as { reasoning?: { effort?: string } } | undefined)
    ?.reasoning;
  return reasoning?.effort;
}

/** The active (default) named LLM, falling back to the first configured one. */
export function activeLlm(config: Config) {
  return config.llms.find((entry) => entry.default) ?? config.llms[0];
}

/** Provider name backing the active LLM, if any is configured. */
export function activeProviderName(config: Config): string | undefined {
  return activeLlm(config)?.provider;
}

/**
 * The effort currently applied to the active model, read from the fully
 * resolved provider options (so overlay/session values are reflected).
 */
export function currentReasoningEffort(config: Config): string | undefined {
  const active = activeLlm(config);
  if (!active) {
    return undefined;
  }
  const resolved = config.resolveLlm(active.name);
  return readProviderEffort(resolved?.providerOptions);
}

/**
 * Parse a user-typed effort argument. Recognizes the four levels plus a set of
 * "off" aliases (mapped to `undefined`). Returns `null` for unrecognized input.
 * Callers should handle the empty-argument case before calling this.
 */
export function parseReasoningEffortArg(
  raw: string,
): { value: string | undefined } | null {
  const t = raw.trim().toLowerCase();
  if (["off", "none", "disable", "disabled", "0"].includes(t)) {
    return { value: undefined };
  }
  if ((REASONING_EFFORT_LEVELS as readonly string[]).includes(t)) {
    return { value: t };
  }
  return null;
}
