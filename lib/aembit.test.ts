import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { aembitAuthWithOidc, aembitGetCredentials, extractCredentialValue, CREDENTIAL_TYPE, type AembitCredentialsResponse } from "./aembit.ts";

describe("aembit Edge API wrapper", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock.fn(originalFetch);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("aembitAuthWithOidc returns parsed token on success", async () => {
    // Arrange
    (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(async () =>
      Response.json({ accessToken: "token123", tokenType: "Bearer", expiresIn: 3600 }),
    );

    // Act
    const result = await aembitAuthWithOidc({
      baseUrl: "https://tenant1.ec.aembit.io",
      clientId: "client-1",
      oidcIdentityToken: "oidc-token",
    });

    // Assert
    assert.deepEqual(result, { accessToken: "token123", tokenType: "Bearer", expiresIn: 3600 });
  });

  it("aembitGetCredentials returns parsed credential on success", async () => {
    // Arrange
    (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(async () =>
      Response.json({ credentialType: "OAuthToken", data: { token: "oauth-abc" }, expiresAt: "2026-03-01T12:00:00Z" }),
    );

    // Act
    const result = await aembitGetCredentials({
      baseUrl: "https://tenant1.ec.aembit.io",
      bearerToken: "bearer-xyz",
      oidcIdentityToken: "oidc-token",
      host: "api.example.com",
      port: 443,
      credentialType: CREDENTIAL_TYPE.OAUTH_TOKEN,
    });

    // Assert
    assert.equal(result.credentialType, CREDENTIAL_TYPE.OAUTH_TOKEN);
    assert.equal(result.data.token, "oauth-abc");
    assert.equal(result.expiresAt, "2026-03-01T12:00:00Z");
  });

  it("throws on non-2xx status with status code in message", async () => {
    // Arrange
    (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid token",
    }));

    // Act & Assert
    await assert.rejects(
      () => aembitAuthWithOidc({ baseUrl: "https://tenant1.ec.aembit.io", clientId: "x", oidcIdentityToken: "y" }),
      (err: Error) => {
        assert.match(err.message, /401/);
        assert.match(err.message, /Unauthorized/);
        return true;
      },
    );
  });

  it("throws on timeout", async () => {
    // Arrange
    (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async (_url: string, options?: RequestInit) => {
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const err = new Error("AbortError");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    );

    // Act & Assert
    await assert.rejects(
      () => aembitAuthWithOidc({ baseUrl: "https://tenant1.ec.aembit.io", clientId: "x", oidcIdentityToken: "y", timeoutMs: 10 }),
      (err: Error) => {
        assert.match(err.message, /timed out after 10ms/);
        return true;
      },
    );
  });

  it("throws on malformed JSON response", async () => {
    // Arrange
    (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(async () =>
      new Response("not json at all", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );

    // Act & Assert
    await assert.rejects(
      () => aembitAuthWithOidc({ baseUrl: "https://tenant1.ec.aembit.io", clientId: "x", oidcIdentityToken: "y" }),
      (err: Error) => {
        assert.match(err.message, /Failed to parse JSON/);
        return true;
      },
    );
  });

  it("extractCredentialValue extracts token from credential response", () => {
    // Arrange
    const creds: AembitCredentialsResponse = {
      credentialType: "OAuthToken",
      data: { token: "my-token-123" },
      expiresAt: null,
    };

    // Act & Assert
    assert.equal(extractCredentialValue(creds), "my-token-123");
    assert.equal(extractCredentialValue(null), null);
  });

  it("throws on invalid response structure", async () => {
    // Arrange
    (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(async () =>
      Response.json({ accessToken: "", tokenType: "Bearer", expiresIn: 3600 }),
    );

    // Act & Assert
    await assert.rejects(
      () => aembitAuthWithOidc({ baseUrl: "https://tenant1.ec.aembit.io", clientId: "x", oidcIdentityToken: "y" }),
      (err: Error) => {
        assert.match(err.message, /Unexpected response shape/);
        return true;
      },
    );
  });

  it("full flow: auth then get credentials", async () => {
    // Arrange
    (globalThis.fetch as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(async (url: string) => {
      if (url.includes("/auth")) {
        return Response.json({ accessToken: "token123", tokenType: "Bearer", expiresIn: 3600 });
      }
      return Response.json({ credentialType: "OAuthToken", data: { token: "oauth-abc" }, expiresAt: null });
    });

    // Act
    const auth = await aembitAuthWithOidc({
      baseUrl: "https://tenant1.ec.aembit.io",
      clientId: "client-1",
      oidcIdentityToken: "oidc-token",
    });
    const creds = await aembitGetCredentials({
      baseUrl: "https://tenant1.ec.aembit.io",
      bearerToken: auth.accessToken,
      oidcIdentityToken: "oidc-token",
      host: "api.example.com",
      port: 443,
      credentialType: CREDENTIAL_TYPE.OAUTH_TOKEN,
    });

    // Assert
    assert.equal(extractCredentialValue(creds), "oauth-abc");
  });
});
