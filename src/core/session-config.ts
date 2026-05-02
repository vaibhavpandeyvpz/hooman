import { Config } from "./config.js";
import { configJsonPath } from "./utils/paths.js";

/**
 * Session-scoped config keeps runtime chat/ACP overrides in memory without
 * rewriting the shared on-disk config file.
 */
export class SessionConfig extends Config {
  public override persist(): void {
    // Session config overrides are intentionally ephemeral.
  }
}

export function createSessionConfig(): SessionConfig {
  return new SessionConfig(configJsonPath());
}
