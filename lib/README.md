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

Both API functions throw `AembitApiError` on non-2xx responses (with `.status`, `.statusText`, `.responseBody`) and plain `Error` on network/timeout failures. Default timeout is 30s, configurable via `timeoutMs`.
