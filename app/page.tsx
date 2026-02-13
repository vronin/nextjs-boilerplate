import Image from "next/image";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  aembitAuthWithOidc,
  aembitGetCredentials,
  extractCredentialValue,
  CREDENTIAL_TYPE,
  type AembitTokenDTO,
  type AembitCredentialsResponse,
} from "@/lib/aembit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_VISIBLE_START = 4;
const DEFAULT_VISIBLE_END = 4;
const DEFAULT_MASK = "****";

interface MaskSecretOptions {
  visibleStart?: number;
  visibleEnd?: number;
  mask?: string;
}

export function maskSecret(value: unknown, options?: MaskSecretOptions): string | null {
  if (typeof value !== "string") return null;

  const { visibleStart = DEFAULT_VISIBLE_START, visibleEnd = DEFAULT_VISIBLE_END, mask = DEFAULT_MASK } = options ?? {};

  if (value.length <= visibleStart + visibleEnd) {
    return mask;
  }

  const prefix = value.slice(0, visibleStart);
  const suffix = visibleEnd > 0 ? value.slice(-visibleEnd) : "";
  return prefix + mask + suffix;
}


function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(b64 + pad, "base64").toString("utf8");
  return JSON.parse(json);
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
      baseUrl: "https://22a7a6.ec.qa.aembit-eng.com/",
      clientId: "aembit:qa:22a7a6:identity:oidc_id_token:46939373-cf2b-4095-98c4-03dbcb11ccbf",
      oidcIdentityToken: await getVercelOidcToken(),
    });

    console.log("Received Aembit token, expires in:", aembitToken.expiresIn, "seconds");
  } catch (e) {
    console.error("Aembit auth failed:", (e as Error).message);
  }

  if (aembitToken) {
    try {
      creds = await aembitGetCredentials({
        baseUrl: "https://22a7a6.ec.qa.aembit-eng.com/",
        bearerToken: aembitToken.accessToken,
        oidcIdentityToken: await getVercelOidcToken(),
        host: "api.example.com",
        port: 443,
        credentialType: CREDENTIAL_TYPE.API_KEY,
      });
    } catch (e) {
      console.error("Aembit get credentials failed:", (e as Error).message);
    }
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
