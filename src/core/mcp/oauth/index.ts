import { Service } from "./service.js";
import { Store } from "./store.js";

export { startCallbackServer, type CallbackResult } from "./callback-server.js";
export {
  canonicalizeRemoteServerUrl,
  createRemoteTransportFingerprint,
  createRemoteTransportIdentity,
  type OAuthRemoteTransport,
} from "./identity.js";
export { HoomanMcpOAuthProvider } from "./provider.js";
export {
  Service as McpOAuthService,
  type BeginAuthorizationResult,
} from "./service.js";
export { Store as McpOAuthStore } from "./store.js";
export {
  McpOAuthConfigSchema,
  StoredMcpOAuthClientSchema,
  StoredMcpOAuthDiscoverySchema,
  StoredMcpOAuthEntrySchema,
  StoredMcpOAuthFileSchema,
  StoredMcpOAuthTokensSchema,
} from "./types.js";
export type {
  McpOAuthConfig,
  StoredMcpOAuthClient,
  StoredMcpOAuthDiscovery,
  StoredMcpOAuthEntry,
  StoredMcpOAuthFile,
  StoredMcpOAuthTokens,
} from "./types.js";

export function createMcpOAuthStore(): Store {
  return new Store();
}

export function createMcpOAuthService(store?: Store): Service {
  return new Service({ store });
}
