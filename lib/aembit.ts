const AUTH_ENDPOINT = "/edge/v1/auth";
const CREDENTIALS_ENDPOINT = "/edge/v1/credentials";
const DEFAULT_TIMEOUT_MS = 3_000;

// --- Types ---

export const CREDENTIAL_TYPE = {
  OAUTH_TOKEN: "OAuthToken",
} as const;

interface IdentityTokenPayload {
  identityToken: string;
}

export interface AembitAuthRequest {
  clientId: string;
  client: {
    oidc?: IdentityTokenPayload;
  };
}

export interface AembitAuthResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export type CredentialType = typeof CREDENTIAL_TYPE[keyof typeof CREDENTIAL_TYPE];

export interface AembitCredentialsResponse {
  credentialType: typeof CREDENTIAL_TYPE.OAUTH_TOKEN;
  expiresAt?: string | null;
  data: { token: string };
}

export interface AembitAuthParams {
  baseUrl: string;
  clientId: string;
  oidcIdentityToken: string;
  timeoutMs?: number;
}

export interface AembitGetCredentialsParams {
  baseUrl: string;
  bearerToken: string;
  oidcIdentityToken: string;
  host: string;
  port: number;
  credentialType: CredentialType;
  transportProtocol?: "TCP";
  timeoutMs?: number;
}

// --- Validation ---

function isAembitAuthResponse(obj: unknown): obj is AembitAuthResponse {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.accessToken === "string" &&
    o.accessToken.length > 0 &&
    typeof o.tokenType === "string" &&
    o.tokenType.length > 0 &&
    typeof o.expiresIn === "number" &&
    o.expiresIn > 0
  );
}

function isAembitCredentialsResponse(obj: unknown): obj is AembitCredentialsResponse {
  if (typeof obj !== "object" || obj === null || !("credentialType" in obj) || !("data" in obj)) {
    return false;
  }

  const creds = obj as Record<string, unknown>;
  const data = creds.data;
  if (typeof data !== "object" || data === null) return false;

  const d = data as Record<string, unknown>;
  if (creds.credentialType !== CREDENTIAL_TYPE.OAUTH_TOKEN) return false;
  return typeof d.token === "string" && d.token.length > 0;
}

// --- Internal helpers ---

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function parseJsonResponse<T>(res: Response, endpoint: string, guard: (obj: unknown) => obj is T): Promise<T> {
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!guard(data)) {
    throw new Error(`Unexpected response shape from ${endpoint}`);
  }

  return data;
}

// --- Public API ---

/**
 * Authenticates with the Aembit Edge API using an OIDC identity token.
 *
 * @throws {Error} On network, timeout, or non-2xx response
 */
export async function aembitAuthWithOidc(params: AembitAuthParams): Promise<AembitAuthResponse> {
  const { baseUrl, clientId, oidcIdentityToken, timeoutMs = DEFAULT_TIMEOUT_MS } = params;

  const url = new URL(AUTH_ENDPOINT, baseUrl).toString();

  const body: AembitAuthRequest = {
    clientId,
    client: { oidc: { identityToken: oidcIdentityToken } },
  };

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Aembit ${AUTH_ENDPOINT} failed: ${res.status} ${res.statusText} ${errorBody}`.trim());
  }

  return parseJsonResponse(res, AUTH_ENDPOINT, isAembitAuthResponse);
}

/**
 * Retrieves credentials from the Aembit Edge API for a target server workload.
 *
 * @throws {Error} On network, timeout, or non-2xx response
 */
export async function aembitGetCredentials(params: AembitGetCredentialsParams): Promise<AembitCredentialsResponse> {
  const { baseUrl, bearerToken, oidcIdentityToken, host, port, credentialType, transportProtocol = "TCP", timeoutMs = DEFAULT_TIMEOUT_MS } = params;

  const url = new URL(CREDENTIALS_ENDPOINT, baseUrl).toString();

  // Wrap bare IPv6 addresses in brackets per URI notation
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        client: { oidc: { identityToken: oidcIdentityToken } },
        server: { transportProtocol, host: formattedHost, port },
        credentialType,
      }),
    },
    timeoutMs,
  );

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Aembit ${CREDENTIALS_ENDPOINT} failed: ${res.status} ${res.statusText} ${errorBody}`.trim());
  }

  return parseJsonResponse(res, CREDENTIALS_ENDPOINT, isAembitCredentialsResponse);
}

/** Extracts the token string from a credentials response. */
export function extractCredentialValue(creds: AembitCredentialsResponse | null): string | null {
  if (!creds) return null;
  return creds.data.token;
}
