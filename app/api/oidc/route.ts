import { getVercelOidcToken } from "@vercel/oidc";

export const runtime = "nodejs"; // OIDC helper is for Functions (Node), not Edge.

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Not a JWT");

  const payload = parts[1];
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(b64 + pad, "base64").toString("utf8");
  return JSON.parse(json);
}

export async function GET(req: Request) {
  try {
    const token = await getVercelOidcToken();
    const claims = decodeJwtPayload(token);

    // Return only a safe subset
    const safeClaims = {
      iss: claims.iss,
      sub: claims.sub,
      aud: claims.aud,
      exp: claims.exp,
      iat: claims.iat,
      nbf: claims.nbf,
      jti: claims.jti,
      azp: claims.azp,
      // keep anything else you specifically want to show:
      // vercel: claims.vercel,
    };

    return Response.json({ claims: safeClaims });
  } catch (e) {
    return Response.json(
      { claims: null, error: (e as Error).message ?? "Failed to get OIDC token" },
      { status: 500 }
    );
  }
}
