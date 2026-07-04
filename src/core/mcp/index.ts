import { Config, type NamedMcpTransport } from "./config.js";
import { createMcpOAuthService, createMcpOAuthStore } from "./oauth/index.js";
import {
  Manager,
  HOOMAN_CHANNEL,
  HOOMAN_CHANNEL_ASK,
  HOOMAN_CHANNEL_PERMISSION,
  type ChannelAskOutcome,
  type ChannelMessage,
  type ChannelPermissionBehavior,
  type ChannelSubscription,
  type ChannelSubscriptionHandle,
  type ServerAuthStatus,
} from "./manager.js";

export { Config, Manager };
export { HOOMAN_CHANNEL, HOOMAN_CHANNEL_ASK, HOOMAN_CHANNEL_PERMISSION };
export { createMcpOAuthService, createMcpOAuthStore };
export type {
  ChannelAskOutcome,
  ChannelMessage,
  ChannelPermissionBehavior,
  ChannelSubscription,
  ChannelSubscriptionHandle,
  NamedMcpTransport,
  ServerAuthStatus,
};

export function createMcpConfig(path: string): Config {
  return new Config(path);
}

export function createMcpManager(
  config: Config,
  acp = false,
  mcpServers: readonly NamedMcpTransport[] = [],
  oauth = createMcpOAuthService(),
): Manager {
  return new Manager(config, acp, mcpServers, oauth);
}
