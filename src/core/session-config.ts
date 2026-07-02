import { Config, type ConfigData, type ConfigUpdateResult } from "./config.js";
import { runtimeConfigOptions } from "./runtime-config.js";
import { configJsonPath } from "./utils/paths.js";

/**
 * Session-scoped config keeps runtime chat/ACP overrides in memory without
 * rewriting the shared on-disk config file.
 */
export class SessionConfig extends Config {
  public override persist(): void {
    // Session config overrides are intentionally ephemeral.
  }

  /**
   * Persist an explicit user preference (e.g. the default model, reasoning
   * effort) to the shared base config file. The change is derived from — and
   * written to — a freshly loaded base config without project overlays, so the
   * session's ephemeral overrides and any overlay-provided values never leak
   * into the shared file. The live session's in-memory state is updated
   * separately by the caller (via `update`).
   */
  public override persistToDisk(
    build: (config: Config) => Partial<ConfigData> | null,
  ): ConfigUpdateResult {
    const base = new Config(this.path);
    const partial = build(base);
    if (!partial) {
      return { ok: true };
    }
    return base.tryUpdate(partial);
  }
}

export function createSessionConfig(): SessionConfig {
  return new SessionConfig(configJsonPath(), runtimeConfigOptions());
}
