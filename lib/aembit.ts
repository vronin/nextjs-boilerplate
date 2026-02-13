const AUTH_ENDPOINT = "/edge/v1/auth";
const CREDENTIALS_ENDPOINT = "/edge/v1/credentials";

const HTTP_POST = "POST";
const CONTENT_TYPE_HEADER = "Content-Type";
const AUTHORIZATION_HEADER = "Authorization";
const JSON_CONTENT_TYPE = "application/json";
const BEARER_PREFIX = "Bearer";
const DEFAULT_TRANSPORT_PROTOCOL = "TCP";
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const MAX_ERROR_BODY_BYTES = 10_000;
const MAX_EXPIRES_IN_SECONDS = 31_536_000;
const REQUIRED_URL_PROTOCOL = "https:";
const HOSTNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4_PATTERN = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const VALID_TRANSPORT_PROTOCOLS = ["TCP", "UDP"] as const;
type TransportProtocol = typeof VALID_TRANSPORT_PROTOCOLS[number];

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
  timeoutMs?: number;
}

export interface AembitGetCredentialsParams {
  baseUrl: string;
  bearerToken: string;
  oidcIdentityToken: string;
  host: string;
  port: number;
  credentialType: CredentialType;
  transportProtocol?: TransportProtocol;
  timeoutMs?: number;
}

// --- Errors ---

/**
 * Error thrown when the Aembit API returns a non-2xx HTTP response.
 * The response body is available via `.responseBody` for debugging
 * but is not included in `.message` to avoid leaking server internals in logs.
 *
 * @example
 * ```typescript
 * try {
 *   await aembitAuthWithOidc(params);
 * } catch (err) {
 *   if (err instanceof AembitApiError) {
 *     console.error(`API error ${err.status}: ${err.responseBody}`);
 *   }
 * }
 * ```
 */
export class AembitApiError extends Error {
  /** HTTP status code (e.g., 401, 500) */
  readonly status: number;
  /** HTTP status text (e.g., "Unauthorized", "Internal Server Error") */
  readonly statusText: string;
  /** Raw response body — use for debugging, avoid logging in production */
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

/** Returns true if value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Throws if value is not a string or is empty/whitespace-only. */
function requireNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string (got ${typeof value})`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${name} cannot be empty or whitespace-only`);
  }
}

/** Throws if value does not look like a JWT (three base64url segments separated by dots). */
function requireJwtFormat(value: string, name: string): void {
  requireNonEmptyString(value, name);
  if (!JWT_PATTERN.test(value)) {
    throw new Error(`${name} must be a valid JWT format (three base64url segments separated by dots)`);
  }
}

/** Throws if baseUrl is not a valid HTTPS URL. Does not echo the value to avoid leaking sensitive data. */
function validateBaseUrl(baseUrl: string): void {
  requireNonEmptyString(baseUrl, "baseUrl");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid baseUrl format");
  }
  if (url.protocol !== REQUIRED_URL_PROTOCOL) {
    throw new Error(`baseUrl must use HTTPS, got protocol: ${url.protocol}`);
  }
}

/** Throws if port is not an integer in the valid range. */
function validatePort(port: number): void {
  if (typeof port !== "number" || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`port must be an integer between ${MIN_PORT} and ${MAX_PORT}`);
  }
}

/**
 * Throws if host is not a valid hostname, IPv4, or IPv6 address.
 * Uses URL parsing for IPv6 to correctly handle all formats (compressed, mixed, zone IDs, etc.).
 * Does not echo the value to avoid leaking sensitive data.
 */
function validateHost(host: string): void {
  requireNonEmptyString(host, "host");

  // Hostname or IPv4 — fast path via regex
  if (HOSTNAME_PATTERN.test(host) || IPV4_PATTERN.test(host)) return;

  // IPv6 — delegate to URL parser which handles all valid formats
  try {
    const stripped = host.replace(/^\[|\]$/g, "");
    new URL(`http://[${stripped}]`);
    return;
  } catch {
    // fall through
  }

  throw new Error("Invalid host format");
}

/** Returns true if host contains a colon (i.e. is an IPv6 address). */
function isIPv6(host: string): boolean {
  return host.includes(":");
}

/** Throws if credentialType is not one of the known CREDENTIAL_TYPE values. */
function validateCredentialType(credentialType: string): void {
  const validTypes = Object.values(CREDENTIAL_TYPE) as string[];
  if (!validTypes.includes(credentialType)) {
    throw new Error(`Invalid credentialType: ${credentialType}. Must be one of: ${validTypes.join(", ")}`);
  }
}

/** Throws if transportProtocol is not one of the known values. */
function validateTransportProtocol(protocol: string): void {
  if (!(VALID_TRANSPORT_PROTOCOLS as readonly string[]).includes(protocol)) {
    throw new Error(`Invalid transportProtocol: ${protocol}. Must be one of: ${VALID_TRANSPORT_PROTOCOLS.join(", ")}`);
  }
}

/** Returns a validated integer timeout, or the default. Throws if out of range. */
function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

/** Checks that obj has the shape of AembitTokenDTO with non-empty fields and bounded positive integer expiresIn. */
function isAembitTokenDTO(obj: unknown): obj is AembitTokenDTO {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    isNonEmptyString(o.accessToken) &&
    isNonEmptyString(o.tokenType) &&
    typeof o.expiresIn === "number" &&
    Number.isInteger(o.expiresIn) &&
    o.expiresIn > 0 &&
    o.expiresIn <= MAX_EXPIRES_IN_SECONDS
  );
}

/** Returns true if value is null, undefined, or a valid ISO 8601 date string. */
function isValidOptionalDateString(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return ISO8601_PATTERN.test(value) && !isNaN(new Date(value).getTime());
}

/** Checks that obj has the shape of AembitCredentialsResponse with non-empty fields. */
function isAembitCredentialsResponse(obj: unknown): obj is AembitCredentialsResponse {
  if (typeof obj !== "object" || obj === null || !("credentialType" in obj) || !("data" in obj)) {
    return false;
  }

  const creds = obj as Record<string, unknown>;

  if (!isValidOptionalDateString(creds.expiresAt)) return false;

  const data = creds.data;
  if (typeof data !== "object" || data === null) return false;

  const d = data as Record<string, unknown>;
  switch (creds.credentialType) {
    case CREDENTIAL_TYPE.API_KEY:
      return isNonEmptyString(d.apiKey);
    case CREDENTIAL_TYPE.USERNAME_PASSWORD:
      return isNonEmptyString(d.username) && isNonEmptyString(d.password);
    case CREDENTIAL_TYPE.OAUTH_TOKEN:
      return isNonEmptyString(d.token);
    default:
      return false;
  }
}

// --- Internal helpers ---

/**
 * Wraps fetch with an AbortController timeout.
 * The timeout is cleared in both success and error paths before returning.
 * Does not include URLs in error messages to avoid leaking internal infrastructure details.
 */
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

/** Parses a JSON response and validates its shape with the provided type guard. */
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

/** Formats a bearer token Authorization header value. */
function formatBearerAuth(token: string): string {
  return `${BEARER_PREFIX} ${token}`;
}

/**
 * Reads the response body as text, truncated to MAX_ERROR_BODY_BYTES.
 * Includes the reason if reading fails instead of silently returning empty.
 */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (text.length > MAX_ERROR_BODY_BYTES) {
      return text.slice(0, MAX_ERROR_BODY_BYTES) + "... (truncated)";
    }
    return text;
  } catch (err) {
    return `(failed to read response body: ${err instanceof Error ? err.message : String(err)})`;
  }
}

/**
 * Formats a host for use in the API request body.
 * Wraps bare IPv6 addresses in brackets per standard URI notation.
 */
function formatHostForRequest(host: string): string {
  if (!isIPv6(host) || host.startsWith("[")) return host;
  return `[${host}]`;
}

// --- Functions ---

/**
 * Authenticates with the Aembit Edge API using an OIDC identity token.
 *
 * @param params.baseUrl - HTTPS base URL of the Aembit Edge API
 * @param params.clientId - Edge Client SDK ID from the Trust Provider
 * @param params.oidcIdentityToken - OIDC JWT identity token
 * @param params.timeoutMs - Request timeout in integer milliseconds (1 000–300 000, defaults to 30 000)
 * @returns Access token and metadata
 * @throws {Error} If parameters are invalid or the network request fails
 * @throws {AembitApiError} If the API returns a non-2xx response
 */
export async function aembitAuthWithOidc(params: AembitAuthParams): Promise<AembitTokenDTO> {
  const { baseUrl, clientId, oidcIdentityToken } = params;
  const timeout = resolveTimeout(params.timeoutMs);

  validateBaseUrl(baseUrl);
  requireNonEmptyString(clientId, "clientId");
  requireJwtFormat(oidcIdentityToken, "oidcIdentityToken");

  const url = new URL(AUTH_ENDPOINT, baseUrl).toString();

  const body: AembitAuthRequest = {
    clientId,
    client: { oidc: { identityToken: oidcIdentityToken } },
  };

  const res = await fetchWithTimeout(
    url,
    {
      method: HTTP_POST,
      headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
    },
    timeout,
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
 * @param params.baseUrl - HTTPS base URL of the Aembit Edge API
 * @param params.bearerToken - Access token obtained from {@link aembitAuthWithOidc}
 * @param params.oidcIdentityToken - OIDC JWT identity token
 * @param params.host - Target server workload hostname, IPv4, or IPv6 address
 * @param params.port - Target server workload port (1–65535)
 * @param params.credentialType - Type of credential to retrieve
 * @param params.transportProtocol - Transport protocol ("TCP" or "UDP", defaults to "TCP")
 * @param params.timeoutMs - Request timeout in integer milliseconds (1 000–300 000, defaults to 30 000)
 * @returns The requested credential
 * @throws {Error} If parameters are invalid or the network request fails
 * @throws {AembitApiError} If the API returns a non-2xx response
 */
export async function aembitGetCredentials(params: AembitGetCredentialsParams): Promise<AembitCredentialsResponse> {
  const { baseUrl, bearerToken, oidcIdentityToken, host, port, credentialType, transportProtocol = DEFAULT_TRANSPORT_PROTOCOL } = params;
  const timeout = resolveTimeout(params.timeoutMs);

  validateBaseUrl(baseUrl);
  requireJwtFormat(bearerToken, "bearerToken");
  requireJwtFormat(oidcIdentityToken, "oidcIdentityToken");
  validateHost(host);
  validatePort(port);
  validateCredentialType(credentialType);
  validateTransportProtocol(transportProtocol);

  const url = new URL(CREDENTIALS_ENDPOINT, baseUrl).toString();

  const res = await fetchWithTimeout(
    url,
    {
      method: HTTP_POST,
      headers: {
        [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
        [AUTHORIZATION_HEADER]: formatBearerAuth(bearerToken),
      },
      body: JSON.stringify({
        client: { oidc: { identityToken: oidcIdentityToken } },
        server: { transportProtocol, host: formatHostForRequest(host), port },
        credentialType,
      }),
    },
    timeout,
  );

  if (!res.ok) {
    const text = await readErrorBody(res);
    throw new AembitApiError(CREDENTIALS_ENDPOINT, res.status, res.statusText, text);
  }

  return parseJsonResponse(res, CREDENTIALS_ENDPOINT, isAembitCredentialsResponse);
}

/**
 * Extracts a single string credential value from a credentials response.
 * For UsernamePassword credentials, returns the username and password
 * separated by a colon (per RFC 7617 Basic Auth `user-id:password` format).
 *
 * @throws {Error} If the username contains a colon (ambiguous per RFC 7617)
 * @returns The credential value, or `null` if `creds` is null
 */
export function extractCredentialValue(creds: AembitCredentialsResponse | null): string | null {
  if (!creds) return null;

  switch (creds.credentialType) {
    case CREDENTIAL_TYPE.API_KEY:
      return creds.data.apiKey;
    case CREDENTIAL_TYPE.OAUTH_TOKEN:
      return creds.data.token;
    case CREDENTIAL_TYPE.USERNAME_PASSWORD: {
      const { username, password } = creds.data;
      if (username.includes(":")) {
        throw new Error("Username contains a colon, which is not allowed per RFC 7617 Basic Auth format");
      }
      return `${username}:${password}`;
    }
    default: {
      const _exhaustive: never = creds;
      return null;
    }
  }
}
