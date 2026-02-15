# Aembit API Client (`lib/aembit.ts`)

## Usage

```typescript
import {
  aembitAuthWithOidc,
  aembitGetCredentials,
  extractCredentialValue,
  CREDENTIAL_TYPE,
} from "@/lib/aembit";

// 1. Get an OIDC identity token (e.g. from Vercel)
const oidcToken = await getVercelOidcToken();

// 2. Exchange it for an Aembit access token
//    Cache this until aembitToken.expiresIn seconds have elapsed.
const aembitToken = await aembitAuthWithOidc({
  baseUrl: "https://your-tenant.ec.aembit.io/",
  clientId: "aembit:...:your-client-id",
  oidcIdentityToken: oidcToken,
});

// 3. Fetch credentials for a target workload
const creds = await aembitGetCredentials({
  baseUrl: "https://your-tenant.ec.aembit.io/",
  bearerToken: aembitToken.accessToken,
  oidcIdentityToken: oidcToken,
  host: "api.example.com",
  port: 443,
  credentialType: CREDENTIAL_TYPE.OAUTH_TOKEN,
});

// 4. Extract the token string
//    Cache using creds.expiresAt.
const secret = extractCredentialValue(creds);
```

## Caching

If this code is called repeatedly (e.g. on every incoming request), avoid re-fetching on every call. Check caches in this order:

1. **Credential still valid?** Use the cached credential (check `creds.expiresAt` for OAuth tokens).
2. **Credential expired but Aembit token still valid?** Re-fetch credentials only (step 3), skip auth.
3. **Aembit token also expired?** Do the full flow from step 1.

The Aembit token lifetime is in `aembitToken.expiresIn` (seconds from issuance). Credential expiry is in `creds.expiresAt` (ISO 8601 timestamp, present for OAuth tokens). Apply a small buffer (e.g. 30s) before actual expiry to avoid using stale tokens.

## Error handling

Both API functions throw `Error` on any failure (network, timeout, non-2xx response, unexpected response shape). The error message includes the endpoint, status code, and response body when available. Default timeout is 3s, configurable via the `timeoutMs` parameter on both `aembitAuthWithOidc` and `aembitGetCredentials`.

## Retries

The SDK does not retry on failure — it fails fast and lets the caller decide. Depending on your context:

- **User-facing request or serverless with a tight timeout?** A single attempt with a short `timeoutMs` is usually fine. Failing quickly is better than making the user wait.
- **Background job or startup-time credential fetch?** Wrapping the call in exponential backoff (e.g. 3 retries, 1s/2s/4s delays) can help ride out transient network issues. Only retry on 5xx or network errors — a 401/403 won't resolve itself.
