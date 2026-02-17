terraform {
  required_providers {
    aembit = {
      source = "aembit/aembit"
    }
  }
}

provider "aembit" {
}

# =============================================================================
# Client Workload - identified by OIDC subject
# =============================================================================
resource "aembit_client_workload" "my_client" {
  name        = "My Vercel App"
  is_active   = true

  identities = [
    {
      type  = "oidcIdTokenSubject"
      value = "owner:aembit:project:nextjs-boilerplate:environment:production"
    },
  ]
}

# =============================================================================
# Trust Provider - OIDC ID Token
# =============================================================================
resource "aembit_trust_provider" "oidc" {
  name      = "Vercel Trust Provider"
  is_active = true

  oidc_id_token = {
    issuer        = "https://oidc.vercel.com/aembit"
    oidc_endpoint = "https://oidc.vercel.com/aembit"
  }
}

# =============================================================================
# Credential Provider - 2-legged OAuth (Client Credentials flow)
# =============================================================================
resource "aembit_credential_provider" "oauth_two_legged" {
  name      = "Apigee Creds Provider"
  is_active = true

  oauth_client_credentials = {
    token_url        = "https://auth.example.com/oauth2/token"
    client_id        = "my_client_id"
    client_secret    = "my_client_secret"
    scopes           = "my_scope"
    credential_style = "authHeader"
  }
}

# =============================================================================
# Server Workload
# =============================================================================
resource "aembit_server_workload" "my_server" {
  name        = "Apigee"
  description = "Target server workload"
  is_active   = true

  service_endpoint = {
    host               = "api.example.com"
    port               = 443
    app_protocol       = "HTTP"
    transport_protocol = "TCP"
    requested_port     = 443
    tls_verification   = "full"
    requested_tls      = true
    tls                = true
    authentication_config = {
			"method" = "HTTP Authentication"
			"scheme" = "Bearer"
		}
  }
}

# =============================================================================
# Access Policy - ties everything together
# =============================================================================
resource "aembit_access_policy" "my_policy" {
  name              = "My Access Policy"
  is_active         = true
  client_workload   = aembit_client_workload.my_client.id
  server_workload   = aembit_server_workload.my_server.id
  credential_provider = aembit_credential_provider.oauth_two_legged.id

  trust_providers = [
    aembit_trust_provider.oidc.id,
  ]

  access_conditions = []
}
