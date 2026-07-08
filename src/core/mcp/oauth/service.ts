import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { openBrowser } from "../../utils/browser.js";
import type { Sse, StreamableHttp } from "../types.js";
import { startCallbackServer, type CallbackServer } from "./callback-server.js";
import { HoomanMcpOAuthProvider } from "./provider.js";
import { Store } from "./store.js";
import { createRemoteTransportFingerprint } from "./identity.js";

export type OAuthRemoteTransport = StreamableHttp | Sse;

export type ServiceOptions = {
  store?: Store;
  clientLabel?: string;
};

export type BeginAuthorizationResult = {
  authorizationUrl: URL;
  complete: (options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }) => Promise<void>;
  cancel: () => Promise<void>;
};

export class Service {
  private readonly store: Store;
  private readonly clientLabel?: string;
  private readonly providers = new Map<string, HoomanMcpOAuthProvider>();

  public constructor(options: ServiceOptions = {}) {
    this.store = options.store ?? new Store();
    this.clientLabel = options.clientLabel;
  }

  public getProvider(
    serverName: string,
    transport: OAuthRemoteTransport,
  ): HoomanMcpOAuthProvider {
    const key = createRemoteTransportFingerprint(serverName, transport);
    let provider = this.providers.get(key);
    if (!provider) {
      provider = new HoomanMcpOAuthProvider({
        serverName,
        transport,
        store: this.store,
        clientLabel: this.clientLabel,
      });
      this.providers.set(key, provider);
    }
    return provider;
  }

  public async hasTokens(
    serverName: string,
    transport: OAuthRemoteTransport,
  ): Promise<boolean> {
    return (
      (await this.getProvider(serverName, transport).tokens()) !== undefined
    );
  }

  public async beginAuthorization(
    serverName: string,
    transport: OAuthRemoteTransport,
  ): Promise<BeginAuthorizationResult> {
    const provider = this.getProvider(serverName, transport);
    provider.resetFlow();

    const callbackServer = await this.createCallbackServer(provider, transport);
    provider.setRedirectUrl(callbackServer.redirectUri);

    let authorizationUrl: URL | undefined;
    try {
      const result = await auth(provider as OAuthClientProvider, {
        serverUrl: transport.url,
      });
      if (result !== "REDIRECT") {
        await callbackServer.close();
        throw new Error(`"${serverName}" is already authorized.`);
      }
      authorizationUrl = provider.takeAuthorizationUrl();
      if (!authorizationUrl) {
        throw new Error("OAuth provider did not produce an authorization URL.");
      }
    } catch (error) {
      await callbackServer.close().catch(() => undefined);
      provider.resetFlow();
      throw wrapAuthError(
        `Failed to start OAuth flow for "${serverName}"`,
        error,
      );
    }

    let settled = false;
    const cancel = async (): Promise<void> => {
      if (settled) {
        return;
      }
      settled = true;
      provider.resetFlow();
      await callbackServer.close().catch(() => undefined);
    };

    return {
      authorizationUrl,
      complete: async ({ signal, timeoutMs } = {}) => {
        if (settled) {
          throw new Error("OAuth flow already completed or cancelled.");
        }
        try {
          const { code, state } = await callbackServer.waitForCode({
            signal,
            timeoutMs,
          });
          const expectedState = provider.expectedState();
          if (expectedState && state !== expectedState) {
            throw new Error("OAuth state mismatch.");
          }
          const result = await auth(provider as OAuthClientProvider, {
            serverUrl: transport.url,
            authorizationCode: code,
          });
          if (result !== "AUTHORIZED") {
            throw new Error(`OAuth exchange returned "${result}".`);
          }
          settled = true;
          provider.resetFlow();
          await callbackServer.close();
        } catch (error) {
          await cancel();
          throw wrapAuthError(`OAuth flow for "${serverName}" failed`, error);
        }
      },
      cancel,
    };
  }

  public async authenticate(
    serverName: string,
    transport: OAuthRemoteTransport,
  ): Promise<void> {
    const flow = await this.beginAuthorization(serverName, transport);
    await openBrowser(flow.authorizationUrl.toString());
    await flow.complete();
  }

  public async logout(
    serverName: string,
    transport: OAuthRemoteTransport,
    scope: "all" | "client" | "tokens" | "discovery" = "all",
  ): Promise<void> {
    await this.getProvider(serverName, transport).invalidateCredentials(scope);
  }

  public async status(
    serverName: string,
    transport: OAuthRemoteTransport,
  ): Promise<"authenticated" | "expired" | "unauthenticated"> {
    const tokens = await this.getProvider(serverName, transport).tokens();
    if (!tokens) {
      return "unauthenticated";
    }
    if (
      tokens.expires_in !== undefined &&
      tokens.expires_in <= 0 &&
      !tokens.refresh_token
    ) {
      return "expired";
    }
    return "authenticated";
  }

  private async createCallbackServer(
    provider: HoomanMcpOAuthProvider,
    transport: OAuthRemoteTransport,
  ): Promise<CallbackServer> {
    // An explicit redirect URI always wins, then an explicit port. Otherwise
    // reuse the redirect a prior dynamic client registration was bound to so
    // the authorization request matches what the OAuth server has on record.
    // With nothing to reuse (first-time registration), fall back to a random
    // ephemeral port.
    const redirectUri =
      transport.oauth?.redirectUri ??
      (transport.oauth?.callbackPort
        ? undefined
        : await provider.registeredRedirectUri());
    if (redirectUri) {
      const url = new URL(redirectUri);
      return startCallbackServer({
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname,
      });
    }
    return startCallbackServer({
      port: transport.oauth?.callbackPort,
    });
  }
}

function wrapAuthError(prefix: string, error: unknown): Error {
  if (error instanceof Error) {
    const wrapped = new Error(`${prefix}: ${error.message}`);
    wrapped.cause = error;
    return wrapped;
  }
  return new Error(`${prefix}: ${String(error)}`);
}
