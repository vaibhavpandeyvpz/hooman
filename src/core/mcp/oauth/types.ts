import { z } from "zod";

export const McpOAuthConfigSchema = z.object({
  enabled: z.boolean().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  authorizationUrl: z.url().optional(),
  tokenUrl: z.url().optional(),
  issuer: z.url().optional(),
  registrationUrl: z.url().optional(),
  scopes: z.array(z.string().min(1)).optional(),
  audiences: z.array(z.string().min(1)).optional(),
  redirectUri: z.url().optional(),
  callbackPort: z.int().min(1).max(65535).optional(),
  tokenParamName: z.string().min(1).optional(),
});

export const StoredMcpOAuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().finite().optional(),
  scope: z.string().min(1).optional(),
  tokenType: z.string().min(1).optional(),
});

export const StoredMcpOAuthClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
  clientIdIssuedAt: z.number().finite().optional(),
  clientSecretExpiresAt: z.number().finite().optional(),
  redirectUris: z.array(z.url()).optional(),
});

export const StoredMcpOAuthDiscoverySchema = z.object({
  authorizationServerUrl: z.string().min(1).optional(),
  resourceMetadataUrl: z.string().min(1).optional(),
});

export const StoredMcpOAuthEntrySchema = z.object({
  serverName: z.string().min(1),
  serverUrl: z.string().min(1),
  tokens: StoredMcpOAuthTokensSchema.optional(),
  client: StoredMcpOAuthClientSchema.optional(),
  discovery: StoredMcpOAuthDiscoverySchema.optional(),
  updatedAt: z.number().finite(),
});

export const StoredMcpOAuthFileSchema = z.object({
  entries: z.record(z.string().min(1), StoredMcpOAuthEntrySchema).default({}),
});

export type McpOAuthConfig = z.infer<typeof McpOAuthConfigSchema>;
export type StoredMcpOAuthTokens = z.infer<typeof StoredMcpOAuthTokensSchema>;
export type StoredMcpOAuthClient = z.infer<typeof StoredMcpOAuthClientSchema>;
export type StoredMcpOAuthDiscovery = z.infer<
  typeof StoredMcpOAuthDiscoverySchema
>;
export type StoredMcpOAuthEntry = z.infer<typeof StoredMcpOAuthEntrySchema>;
export type StoredMcpOAuthFile = z.infer<typeof StoredMcpOAuthFileSchema>;
