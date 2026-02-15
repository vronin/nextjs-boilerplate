const AUTH_ENDPOINT = "/edge/v1/auth";
const CREDENTIALS_ENDPOINT = "/edge/v1/credentials";
const DEFAULT_TIMEOUT_MS = 30_000;

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

export interface AembitTokenDTO {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export type CredentialType = typeof CREDENTIAL_TYPE[keyof typeof CREDENTIAL_TYPE];

export type AembitCredentialsResponse =
  { credentialType: typeof CREDENTIAL_TYPE.OAUTH_TOKEN; expiresAt?: string | null; data: { token: string } };

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

// --- Errors ---

/**
 * Error thrown when the Aembit API returns a non-2xx HTTP response.
 * The response body is available via `.responseBody` for debugging.
 */
export class AembitApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly responseBody: string;

  constructor(endpoint: string, status: number, statusText: string, responseBody: string) {
    super(`Aembit ${endpoint} failed: ${status} ${statusText}`);
    this.name = "AembitApiError";
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
  }
}

// --- Validation ---

function isAembitTokenDTO(obj: unknown): obj is AembitTokenDTO {
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

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 10_000 ? text.slice(0, 10_000) + "... (truncated)" : text;
  } catch (err) {
    return `(failed to read response body: ${err instanceof Error ? err.message : String(err)})`;
  }
}

// --- Public API ---

/**
 * Authenticates with the Aembit Edge API using an OIDC identity token.
 *
 * @throws {AembitApiError} If the API returns a non-2xx response
 */
export async function aembitAuthWithOidc(params: AembitAuthParams): Promise<AembitTokenDTO> {
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
    const text = await readErrorBody(res);
    throw new AembitApiError(AUTH_ENDPOINT, res.status, res.statusText, text);
  }

  return parseJsonResponse(res, AUTH_ENDPOINT, isAembitTokenDTO);
}

/**
 * Retrieves credentials from the Aembit Edge API for a target server workload.
 *
 * @throws {AembitApiError} If the API returns a non-2xx response
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
    const text = await readErrorBody(res);
    throw new AembitApiError(CREDENTIALS_ENDPOINT, res.status, res.statusText, text);
  }

  return parseJsonResponse(res, CREDENTIALS_ENDPOINT, isAembitCredentialsResponse);
}

/** Extracts the token string from a credentials response. */
export function extractCredentialValue(creds: AembitCredentialsResponse | null): string | null {
  if (!creds) return null;
  return creds.data.token;
}
