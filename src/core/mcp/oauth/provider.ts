import { randomBytes } from "node:crypto";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Sse, StreamableHttp } from "../types.js";
import { createRemoteTransportIdentity } from "./identity.js";
import { Store } from "./store.js";
import type { McpOAuthConfig, StoredMcpOAuthEntry } from "./types.js";

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:19876/mcp/oauth/callback";

export type ProviderOptions = {
  serverName: string;
  transport: StreamableHttp | Sse;
  store?: Store;
  clientLabel?: string;
};

export class HoomanMcpOAuthProvider implements OAuthClientProvider {
  private readonly store: Store;
  private readonly clientLabel: string;
  private readonly identity: ReturnType<typeof createRemoteTransportIdentity>;
  private _redirectUrl?: string;
  private _codeVerifier?: string;
  private _state?: string;
  private _authorizationUrl?: URL;

  public constructor(private readonly options: ProviderOptions) {
    this.store = options.store ?? new Store();
    this.clientLabel = options.clientLabel ?? `Hooman (${options.serverName})`;
    this.identity = createRemoteTransportIdentity(
      options.serverName,
      options.transport,
    );
  }

  public get key(): string {
    return this.identity.key;
  }

  public get redirectUrl(): string {
    return (
      this._redirectUrl ??
      this.options.transport.oauth?.redirectUri ??
      DEFAULT_REDIRECT_URI
    );
  }

  public get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: this.options.transport.oauth?.clientSecret
        ? "client_secret_post"
        : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: this.clientLabel,
      ...(this.options.transport.oauth?.scopes?.length
        ? { scope: this.options.transport.oauth.scopes.join(" ") }
        : {}),
    };
  }

  public setRedirectUrl(url: string | URL): void {
    this._redirectUrl = String(url);
  }

  public takeAuthorizationUrl(): URL | undefined {
    const url = this._authorizationUrl;
    this._authorizationUrl = undefined;
    return url;
  }

  public expectedState(): string | undefined {
    return this._state;
  }

  public resetFlow(): void {
    this._redirectUrl = undefined;
    this._codeVerifier = undefined;
    this._state = undefined;
    this._authorizationUrl = undefined;
  }

  public state(): string {
    this._state ??= randomBytes(16).toString("hex");
    return this._state;
  }

  public async clientInformation(): Promise<
    OAuthClientInformationMixed | undefined
  > {
    const oauth = this.options.transport.oauth;
    if (oauth?.clientId) {
      return {
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
      };
    }
    const entry = await this.store.get(this.key);
    if (!entry?.client) {
      return undefined;
    }
    return {
      client_id: entry.client.clientId,
      client_secret: entry.client.clientSecret,
      client_id_issued_at: entry.client.clientIdIssuedAt,
      client_secret_expires_at: entry.client.clientSecretExpiresAt,
      ...(entry.client.redirectUris
        ? { redirect_uris: entry.client.redirectUris }
        : {}),
    };
  }

  public async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    const existing = await this.readEntry();
    const redirectUris =
      "redirect_uris" in clientInformation
        ? [...clientInformation.redirect_uris]
        : existing?.client?.redirectUris;
    await this.writeEntry({
      ...existing,
      client: {
        clientId: clientInformation.client_id,
        clientSecret: clientInformation.client_secret,
        clientIdIssuedAt: clientInformation.client_id_issued_at,
        clientSecretExpiresAt: clientInformation.client_secret_expires_at,
        ...(redirectUris ? { redirectUris } : {}),
      },
    });
  }

  public async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await this.store.get(this.key);
    if (!entry?.tokens) {
      return undefined;
    }
    return {
      access_token: entry.tokens.accessToken,
      token_type: entry.tokens.tokenType ?? "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in:
        entry.tokens.expiresAt !== undefined
          ? Math.max(
              0,
              Math.floor((entry.tokens.expiresAt - Date.now()) / 1000),
            )
          : undefined,
      scope: entry.tokens.scope,
    };
  }

  public async saveTokens(tokens: OAuthTokens): Promise<void> {
    const existing = await this.readEntry();
    await this.writeEntry({
      ...existing,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt:
          tokens.expires_in !== undefined
            ? Date.now() + tokens.expires_in * 1000
            : undefined,
        scope: tokens.scope,
        tokenType: tokens.token_type,
      },
    });
  }

  public async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this._authorizationUrl = authorizationUrl;
  }

  public saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  public codeVerifier(): string {
    if (!this._codeVerifier) {
      throw new Error("OAuth code verifier is not initialized.");
    }
    return this._codeVerifier;
  }

  public async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const existing = await this.readEntry();
    await this.writeEntry({
      ...existing,
      discovery: {
        authorizationServerUrl: state.authorizationServerUrl,
        resourceMetadataUrl: state.resourceMetadataUrl,
      },
    });
  }

  public async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const entry = await this.store.get(this.key);
    if (!entry?.discovery?.authorizationServerUrl) {
      return undefined;
    }
    return {
      authorizationServerUrl: entry.discovery.authorizationServerUrl,
      resourceMetadataUrl: entry.discovery.resourceMetadataUrl,
    };
  }

  public async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "verifier") {
      this._codeVerifier = undefined;
      return;
    }
    if (scope === "all") {
      await this.store.delete(this.key);
      this.resetFlow();
      return;
    }
    const existing = await this.readEntry();
    if (!existing) {
      return;
    }
    if (scope === "client") {
      delete existing.client;
    } else if (scope === "tokens") {
      delete existing.tokens;
    } else if (scope === "discovery") {
      delete existing.discovery;
    }
    await this.writeEntry(existing);
  }

  public oauthConfig(): McpOAuthConfig | undefined {
    return this.options.transport.oauth;
  }

  private async readEntry(): Promise<StoredMcpOAuthEntry | undefined> {
    return this.store.get(this.key);
  }

  private async writeEntry(
    value: Omit<StoredMcpOAuthEntry, "serverName" | "serverUrl" | "updatedAt"> &
      Partial<
        Pick<StoredMcpOAuthEntry, "serverName" | "serverUrl" | "updatedAt">
      >,
  ): Promise<void> {
    await this.store.set(this.key, {
      serverName: this.identity.serverName,
      serverUrl: this.identity.serverUrl,
      updatedAt: Date.now(),
      ...value,
    });
  }
}
