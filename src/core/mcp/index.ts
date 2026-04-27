import { Config, type NamedMcpTransport } from "./config.js";
import {
  Manager,
  HOOMAN_CHANNEL,
  HOOMAN_CHANNEL_PERMISSION,
  type ChannelMessage,
  type ChannelPermissionBehavior,
  type ChannelSubscription,
  type ChannelSubscriptionHandle,
} from "./manager.js";

export { Config, Manager };
export { HOOMAN_CHANNEL, HOOMAN_CHANNEL_PERMISSION };
export type {
  ChannelMessage,
  ChannelPermissionBehavior,
  ChannelSubscription,
  ChannelSubscriptionHandle,
  NamedMcpTransport,
};
export { createMcpTools } from "./tools.js";

export function createMcpConfig(path: string): Config {
  return new Config(path);
}

export function createMcpManager(
  config: Config,
  acp = false,
  mcpServers: readonly NamedMcpTransport[] = [],
): Manager {
  return new Manager(config, acp, mcpServers);
}
