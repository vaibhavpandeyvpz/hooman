import { Config } from "../core/config.js";
import { configJsonPath } from "../core/utils/paths.js";

/**
 * ACP sessions keep config changes in memory so session-scoped toggles do not
 * rewrite the shared on-disk config.
 */
export class ImmutableConfig extends Config {
  public override persist(): void {
    // ACP session config is intentionally ephemeral.
  }
}

export function createAcpSessionConfig(): ImmutableConfig {
  return new ImmutableConfig(configJsonPath());
}
