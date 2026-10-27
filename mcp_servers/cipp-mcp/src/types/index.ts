// CIPP MCP Type Definitions
// Defines all shared interfaces used across the CIPP MCP server.
// CIPP is an Azure Function App providing M365 multi-tenant management for MSPs.

// ---------------------------------------------------------------------------
// MCP Server Configuration
// ---------------------------------------------------------------------------

/**
 * Top-level MCP server configuration, merging server identity with CIPP
 * connection details. Used to initialise both the MCP server and the CIPP
 * API client.
 */
export interface McpServerConfig {
  /** Human-readable server name surfaced to MCP clients. */
  name: string;
  /** SemVer string for this server build. */
  version: string;
  /** CIPP API connection details. */
  cipp: {
    /** Base URL of the CIPP Azure Function App (e.g. https://cipp.contoso.com). */
    baseUrl?: string;
    /**
     * Static Bearer token used to authenticate against CIPP. Mutually exclusive
     * with the OAuth client-credentials fields below — if both are provided,
     * the static `apiKey` wins.
     */
    apiKey?: string;
    /** Entra tenant (directory) ID that owns the CIPP API-client app registration. */
    tenantId?: string;
    /** Application (client) ID of the CIPP API client used for OAuth exchange. */
    clientId?: string;
    /** Application secret value issued for the CIPP API client. */
    clientSecret?: string;
    /** Optional OAuth scope override. Defaults to `<clientId>/.default`. */
    tokenScope?: string;
    /** Optional full token endpoint URL override (sovereign clouds / custom STS). */
    tokenUrl?: string;
  };
}
