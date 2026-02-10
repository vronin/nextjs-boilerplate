import Image from "next/image";
import { getVercelOidcToken } from "@vercel/oidc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(b64 + pad, "base64").toString("utf8");
  return JSON.parse(json);
}

export type AembitTokenDTO = {
  accessToken: string;
  tokenType: string;   // typically "Bearer"
  expiresIn: number;   // seconds
};

export type AembitAuthRequest = {
  clientId: string;
  client: {
    // Generic OIDC (seen in the API reference snippet)
    oidc?: { identityToken: string };

    // Also-supported CI/CD provider-specific attestation shapes
    github?: { identityToken: string };
    gitlab?: { identityToken: string };
    terraform?: { identityToken: string };
  };
};

export async function aembitAuthWithOidc(params: {
  baseUrl: string;          // e.g. "https://<your-edge-api-base-url>"
  clientId: string;         // Edge Client SDK ID from Trust Provider
  oidcIdentityToken: string; // your OIDC JWT (starts with "ey...")
}): Promise<AembitTokenDTO> {
  const { baseUrl, clientId, oidcIdentityToken } = params;

  const url = new URL("/edge/v1/auth", baseUrl).toString();

  const body: AembitAuthRequest = {
    clientId,
    client: {
      oidc: { identityToken: oidcIdentityToken },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Aembit /auth failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  // Response is TokenDTO: { accessToken, tokenType, expiresIn }
  return (await res.json()) as AembitTokenDTO;
}

type CredentialType = "ApiKey" | "UsernamePassword" | "OAuthToken" | string;

type AembitCredentialsResponse =
  | { credentialType: "ApiKey"; expiresAt?: string | null; data: { apiKey: string } }
  | { credentialType: "UsernamePassword"; expiresAt?: string | null; data: { username: string; password: string } }
  | { credentialType: "OAuthToken"; expiresAt?: string | null; data: { token: string } }
  | { credentialType: string; expiresAt?: string | null; data: Record<string, unknown> };

export async function aembitGetCredentials(params: {
  baseUrl: string;        // e.g. "https://22a7a6.aembit-eng.com/"
  bearerToken: string;    // accessToken from /edge/v1/auth
  oidcIdentityToken: string;
  host: string;           // target Server Workload host
  port: number;           // target Server Workload port
  credentialType: CredentialType;
}): Promise<AembitCredentialsResponse> {
  console.log("Requesting credentials with params:", {
    baseUrl: params.baseUrl,
    host: params.host,
    port: params.port,
    credentialType: params.credentialType,
    bearerToken: params.bearerToken
  });
  const { baseUrl, bearerToken, oidcIdentityToken, host, port, credentialType } = params;

  const url = new URL("/edge/v1/credentials", baseUrl).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      client: {
        oidc: { identityToken: oidcIdentityToken }, // undocumented, but works in your /auth flow
      },
      server: {
        transportProtocol: "TCP",
        host,
        port,
      },
      credentialType,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Aembit /credentials failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  return (await res.json()) as AembitCredentialsResponse;
}

function extractCredentialValue(creds: any): string | null {
  if (!creds || typeof creds !== "object") return null;
  if (!creds.data || typeof creds.data !== "object") return null;

  if ("apiKey" in creds.data) return creds.data.apiKey;
  if ("token" in creds.data) return creds.data.token;

  return null;
}

export function maskSecret(
  value: unknown,
  options?: { visibleStart?: number; visibleEnd?: number; mask?: string }
): string | null {
  if (typeof value !== "string") return null;

  const visibleStart = options?.visibleStart ?? 4;
  const visibleEnd = options?.visibleEnd ?? 4;
  const mask = options?.mask ?? "****";

  if (value.length <= visibleStart + visibleEnd) {
    return value;
  }

  return (
    value.slice(0, visibleStart) +
    mask +
    value.slice(-visibleEnd)
  );
}

export default async function Home() {
  let claims: any = null;
  let error: string | null = null;
  let aembitToken: AembitTokenDTO | null = null;
  let creds: AembitCredentialsResponse | null = null;

  try {
    const token = await getVercelOidcToken();
    const decoded = decodeJwtPayload(token);

    claims = {
      iss: decoded.iss,
      sub: decoded.sub,
      aud: decoded.aud,
      exp: decoded.exp,
      iat: decoded.iat,
      nbf: decoded.nbf,
      azp: decoded.azp,
    };
  } catch (e) {
    error = (e as Error).message;
  }

  try {
    aembitToken = await aembitAuthWithOidc({
      baseUrl: "https://22a7a6.aembit-eng.com/",
      clientId: "aembit:qa:22a7a6:identity:oidc_id_token:46939373-cf2b-4095-98c4-03dbcb11ccbf",
      oidcIdentityToken: await getVercelOidcToken(),
    });
    
    console.log("Received Aembit token:", aembitToken);
  } catch (e) {
    console.error("Aembit auth failed:", (e as Error).message);
  }

  try {
    creds = await aembitGetCredentials({
      baseUrl: "https://22a7a6.aembit-eng.com/",
      bearerToken: aembitToken?.accessToken || "",
      oidcIdentityToken: await getVercelOidcToken(), 
      host: "api.example.com",
      port: 443,
      credentialType: "ApiKey",
    });
  } catch (e) {
    console.error("Aembit get credentials failed:", (e as Error).message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />

        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            To get started, edit the page.tsx file.
          </h1>

          <div className="w-full max-w-md rounded-lg border border-black/10 p-4 text-left dark:border-white/20">
            <div className="mb-2 font-semibold text-black dark:text-zinc-50">
              Vercel OIDC claims (runtime)
            </div>

            {claims ? (
              <pre className="whitespace-pre-wrap break-all text-xs text-zinc-700 dark:text-zinc-300">
                {JSON.stringify(claims, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No claims available. {error ? `Error: ${error}` : ""}
              </p>
            )}
          </div>

        <div className="w-full max-w-md rounded-lg border border-black/10 p-4 text-left dark:border-white/20">
          <div className="mb-2 font-semibold text-black dark:text-zinc-50">
            Aembit Token Expiration
          </div>
          {aembitToken ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Expires in: {aembitToken.expiresIn} seconds
            </p>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No Aembit token available.
            </p>
          )}
        </div>
        </div>

        <div className="w-full max-w-md rounded-lg border border-black/10 p-4 text-left dark:border-white/20">
          <div className="mb-2 font-semibold text-black dark:text-zinc-50">
            Credential Preview
          </div>

          {(() => {
            const rawValue = extractCredentialValue(creds);
            const maskedValue = maskSecret(rawValue);

            if (!maskedValue) {
              return (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  No credentials available.
                </p>
              );
            }

            return (
              <pre className="whitespace-pre-wrap break-all text-xs text-zinc-700 dark:text-zinc-300">
                {maskedValue}
              </pre>
            );
          })()}
        </div>

        {/* rest of your existing content unchanged */}
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          {/* ... */}
        </div>
      </main>
    </div>
  );
}
