import { Config, type NamedMcpTransport } from "./config.ts";
import {
  Manager,
  HOOMAN_CHANNEL,
  HOOMAN_CHANNEL_PERMISSION,
  type ChannelMessage,
  type ChannelPermissionBehavior,
} from "./manager.ts";

export { Config, Manager };
export { HOOMAN_CHANNEL, HOOMAN_CHANNEL_PERMISSION };
export type { ChannelMessage, ChannelPermissionBehavior, NamedMcpTransport };
export { createMcpTools } from "./tools.ts";

export function createMcpConfig(path: string): Config {
  return new Config(path);
}

export function createMcpManager(
  config: Config,
  mcpServers: readonly NamedMcpTransport[] = [],
): Manager {
  return new Manager(config, mcpServers);
}
