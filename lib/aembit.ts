const AUTH_ENDPOINT = "/edge/v1/auth";
const CREDENTIALS_ENDPOINT = "/edge/v1/credentials";

const HTTP_POST = "POST";
const CONTENT_TYPE_HEADER = "Content-Type";
const JSON_CONTENT_TYPE = "application/json";
const BEARER_PREFIX = "Bearer";
const DEFAULT_TRANSPORT_PROTOCOL = "TCP";
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

// --- Types ---

export const CREDENTIAL_TYPE = {
  API_KEY: "ApiKey",
  USERNAME_PASSWORD: "UsernamePassword",
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
  | { credentialType: typeof CREDENTIAL_TYPE.API_KEY; expiresAt?: string | null; data: { apiKey: string } }
  | { credentialType: typeof CREDENTIAL_TYPE.USERNAME_PASSWORD; expiresAt?: string | null; data: { username: string; password: string } }
  | { credentialType: typeof CREDENTIAL_TYPE.OAUTH_TOKEN; expiresAt?: string | null; data: { token: string } };

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

// --- Validation ---

function requireNonEmptyString(value: string, name: string): void {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required and must be a non-empty string`);
  }
}

function validateBaseUrl(baseUrl: string): void {
  requireNonEmptyString(baseUrl, "baseUrl");
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`Invalid baseUrl format: ${baseUrl}`);
  }
}

function validatePort(port: number): void {
  if (typeof port !== "number" || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`port must be an integer between ${MIN_PORT} and ${MAX_PORT}`);
  }
}

function isAembitTokenDTO(obj: unknown): obj is AembitTokenDTO {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "accessToken" in obj &&
    typeof (obj as AembitTokenDTO).accessToken === "string" &&
    "tokenType" in obj &&
    typeof (obj as AembitTokenDTO).tokenType === "string" &&
    "expiresIn" in obj &&
    typeof (obj as AembitTokenDTO).expiresIn === "number"
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
  switch (creds.credentialType) {
    case CREDENTIAL_TYPE.API_KEY:
      return typeof d.apiKey === "string";
    case CREDENTIAL_TYPE.USERNAME_PASSWORD:
      return typeof d.username === "string" && typeof d.password === "string";
    case CREDENTIAL_TYPE.OAUTH_TOKEN:
      return typeof d.token === "string";
    default:
      return false;
  }
}

// --- Internal helpers ---

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Network error requesting ${url}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeoutId);
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

// --- Functions ---

/**
 * Authenticates with the Aembit Edge API using an OIDC identity token.
 *
 * @param params.baseUrl - Base URL of the Aembit Edge API
 * @param params.clientId - Edge Client SDK ID from the Trust Provider
 * @param params.oidcIdentityToken - OIDC JWT identity token
 * @returns Access token and metadata
 * @throws {Error} If parameters are invalid or the network request fails
 * @throws {AembitApiError} If the API returns a non-2xx response
 */
export async function aembitAuthWithOidc(params: AembitAuthParams): Promise<AembitTokenDTO> {
  const { baseUrl, clientId, oidcIdentityToken } = params;

  validateBaseUrl(baseUrl);
  requireNonEmptyString(clientId, "clientId");
  requireNonEmptyString(oidcIdentityToken, "oidcIdentityToken");

  const url = new URL(AUTH_ENDPOINT, baseUrl).toString();

  const body: AembitAuthRequest = {
    clientId,
    client: { oidc: { identityToken: oidcIdentityToken } },
  };

  const res = await fetchWithTimeout(url, {
    method: HTTP_POST,
    headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AembitApiError(AUTH_ENDPOINT, res.status, res.statusText, text);
  }

  return parseJsonResponse(res, AUTH_ENDPOINT, isAembitTokenDTO);
}

/**
 * Retrieves credentials from the Aembit Edge API for a target server workload.
 *
 * @param params.baseUrl - Base URL of the Aembit Edge API
 * @param params.bearerToken - Access token obtained from {@link aembitAuthWithOidc}
 * @param params.oidcIdentityToken - OIDC JWT identity token
 * @param params.host - Target server workload host
 * @param params.port - Target server workload port (1–65535)
 * @param params.credentialType - Type of credential to retrieve
 * @param params.transportProtocol - Transport protocol (defaults to "TCP")
 * @returns The requested credential
 * @throws {Error} If parameters are invalid or the network request fails
 * @throws {AembitApiError} If the API returns a non-2xx response
 */
export async function aembitGetCredentials(params: AembitGetCredentialsParams): Promise<AembitCredentialsResponse> {
  const { baseUrl, bearerToken, oidcIdentityToken, host, port, credentialType, transportProtocol = DEFAULT_TRANSPORT_PROTOCOL } = params;

  validateBaseUrl(baseUrl);
  requireNonEmptyString(bearerToken, "bearerToken");
  requireNonEmptyString(oidcIdentityToken, "oidcIdentityToken");
  requireNonEmptyString(host, "host");
  validatePort(port);

  const url = new URL(CREDENTIALS_ENDPOINT, baseUrl).toString();

  const res = await fetchWithTimeout(url, {
    method: HTTP_POST,
    headers: {
      [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
      Authorization: `${BEARER_PREFIX} ${bearerToken}`,
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

  return parseJsonResponse(res, CREDENTIALS_ENDPOINT, isAembitCredentialsResponse);
}

/**
 * Extracts a single string credential value from a credentials response.
 * For UsernamePassword credentials, returns `"username:password"`.
 *
 * @returns The credential value, or `null` if `creds` is null
 */
export function extractCredentialValue(creds: AembitCredentialsResponse | null): string | null {
  if (!creds) return null;

  switch (creds.credentialType) {
    case CREDENTIAL_TYPE.API_KEY:
      return creds.data.apiKey;
    case CREDENTIAL_TYPE.OAUTH_TOKEN:
      return creds.data.token;
    case CREDENTIAL_TYPE.USERNAME_PASSWORD:
      return `${creds.data.username}:${creds.data.password}`;
    default: {
      const _exhaustive: never = creds;
      return null;
    }
  }
}
