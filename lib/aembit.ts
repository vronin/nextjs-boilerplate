const AUTH_ENDPOINT = "/edge/v1/auth";
const CREDENTIALS_ENDPOINT = "/edge/v1/credentials";

// --- Types ---

interface IdentityTokenPayload {
  identityToken: string;
}

export interface AembitTokenDTO {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface AembitAuthRequest {
  clientId: string;
  client: {
    oidc?: IdentityTokenPayload;
    github?: IdentityTokenPayload;
    gitlab?: IdentityTokenPayload;
    terraform?: IdentityTokenPayload;
  };
}

export type CredentialType = "ApiKey" | "UsernamePassword" | "OAuthToken";

export type AembitCredentialsResponse =
  | { credentialType: "ApiKey"; expiresAt?: string | null; data: { apiKey: string } }
  | { credentialType: "UsernamePassword"; expiresAt?: string | null; data: { username: string; password: string } }
  | { credentialType: "OAuthToken"; expiresAt?: string | null; data: { token: string } };

export interface AembitAuthParams {
  baseUrl: string;
  clientId: string;
  oidcIdentityToken: string;
}

export interface AembitGetCredentialsParams {
  baseUrl: string;
  bearerToken: string;
  oidcIdentityToken: string;
  host: string;
  port: number;
  credentialType: CredentialType;
  transportProtocol?: string;
}

export interface MaskSecretOptions {
  visibleStart?: number;
  visibleEnd?: number;
  mask?: string;
}

// --- Errors ---

export class AembitApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly responseBody: string;

  constructor(endpoint: string, status: number, statusText: string, responseBody: string) {
    super(`Aembit ${endpoint} failed: ${status} ${statusText}${responseBody ? ` - ${responseBody}` : ""}`);
    this.name = "AembitApiError";
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
  }
}

// --- Functions ---

export async function aembitAuthWithOidc(params: AembitAuthParams): Promise<AembitTokenDTO> {
  const { baseUrl, clientId, oidcIdentityToken } = params;
  const url = new URL(AUTH_ENDPOINT, baseUrl).toString();

  const body: AembitAuthRequest = {
    clientId,
    client: { oidc: { identityToken: oidcIdentityToken } },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AembitApiError(AUTH_ENDPOINT, res.status, res.statusText, text);
  }

  return (await res.json()) as AembitTokenDTO;
}

export async function aembitGetCredentials(params: AembitGetCredentialsParams): Promise<AembitCredentialsResponse> {
  const { baseUrl, bearerToken, oidcIdentityToken, host, port, credentialType, transportProtocol = "TCP" } = params;
  const url = new URL(CREDENTIALS_ENDPOINT, baseUrl).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      client: { oidc: { identityToken: oidcIdentityToken } },
      server: { transportProtocol, host, port },
      credentialType,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AembitApiError(CREDENTIALS_ENDPOINT, res.status, res.statusText, text);
  }

  return (await res.json()) as AembitCredentialsResponse;
}

export function extractCredentialValue(creds: AembitCredentialsResponse | null): string | null {
  if (!creds) return null;

  switch (creds.credentialType) {
    case "ApiKey":
      return creds.data.apiKey;
    case "OAuthToken":
      return creds.data.token;
    case "UsernamePassword":
      return null;
    default: {
      const _exhaustive: never = creds;
      return null;
    }
  }
}

export function maskSecret(value: unknown, options?: MaskSecretOptions): string | null {
  if (typeof value !== "string") return null;

  const { visibleStart = 4, visibleEnd = 4, mask = "****" } = options ?? {};

  if (value.length <= visibleStart + visibleEnd) {
    return mask;
  }

  return value.slice(0, visibleStart) + mask + value.slice(-visibleEnd);
}
