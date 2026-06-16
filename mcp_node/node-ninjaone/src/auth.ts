/**
 * OAuth 2.0 Client Credentials token management for NinjaOne API
 */

import type { ResolvedConfig } from './config.js';
import { NinjaOneAuthenticationError } from './errors.js';

/**
 * Token information
 */
export interface TokenInfo {
  /** Access token */
  accessToken: string;
  /** Token type (usually 'Bearer') */
  tokenType: string;
  /** Unix timestamp (milliseconds) when the token expires */
  expiresAt: number;
  /** Scope granted */
  scope: string;
}

/**
 * OAuth token response from the API
 */
interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Buffer time before expiry to trigger refresh (2 minutes in milliseconds)
 */
const EXPIRY_BUFFER_MS = 2 * 60 * 1000;

/**
 * Manages OAuth 2.0 Client Credentials token lifecycle for the NinjaOne API
 */
export class AuthManager {
  private readonly config: ResolvedConfig;
  private token: TokenInfo | null = null;
  private refreshPromise: Promise<TokenInfo> | null = null;

  constructor(config: ResolvedConfig) {
    this.config = config;
  }

  /**
   * Get a valid access token, acquiring or refreshing as needed
   */
  async getToken(): Promise<string> {
    // External supplier path (e.g. user authorization_code flow handled outside
    // the SDK). The supplier is responsible for its own caching and refresh.
    if (this.config.tokenSupplier) {
      return this.config.tokenSupplier();
    }

    // If we have a valid token that's not near expiry, return it
    if (this.token && !this.isTokenNearExpiry(this.token)) {
      return this.token.accessToken;
    }

    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      const token = await this.refreshPromise;
      return token.accessToken;
    }

    // Acquire a new token
    const token = await this.acquireToken();
    return token.accessToken;
  }

  /**
   * Force a token refresh (e.g., after a 401 response)
   */
  async refreshToken(): Promise<string> {
    // Clear the current token
    this.token = null;

    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      const token = await this.refreshPromise;
      return token.accessToken;
    }

    // Acquire a new token
    const token = await this.acquireToken();
    return token.accessToken;
  }

  /**
   * Invalidate the current token
   */
  invalidateToken(): void {
    this.token = null;
  }

  /**
   * Check if the token is valid and not near expiry
   */
  hasValidToken(): boolean {
    return this.token !== null && !this.isTokenNearExpiry(this.token);
  }

  /**
   * Acquire a new token from the API
   */
  private async acquireToken(): Promise<TokenInfo> {
    // Set up the promise to prevent concurrent requests
    this.refreshPromise = this.doAcquireToken();

    try {
      const token = await this.refreshPromise;
      this.token = token;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform the actual token acquisition using Client Credentials flow
   */
  private async doAcquireToken(): Promise<TokenInfo> {
    // NinjaOne's OAuth token endpoint lives under /ws/oauth/token (verified
    // against the official NinjaOne API docs and the authorization_code flow
    // used by the MCP server). The bare /oauth/token path 404s.
    const tokenUrl = `${this.config.baseUrl}/ws/oauth/token`;

    // Build the request body for client credentials flow
    const bodyParams = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scopes.join(' '),
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new NinjaOneAuthenticationError(
          `Failed to acquire token: ${response.status} ${response.statusText}`,
          response.status,
          errorBody
        );
      }

      const data = (await response.json()) as OAuthTokenResponse;

      // Calculate expiry time (expires_in is in seconds)
      const expiresAt = Date.now() + data.expires_in * 1000;

      return {
        accessToken: data.access_token,
        tokenType: data.token_type,
        expiresAt,
        scope: data.scope ?? this.config.scopes.join(' '),
      };
    } catch (error) {
      if (error instanceof NinjaOneAuthenticationError) {
        throw error;
      }
      throw new NinjaOneAuthenticationError(
        `Failed to acquire token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0,
        error
      );
    }
  }

  /**
   * Check if a token is within the expiry buffer
   */
  private isTokenNearExpiry(token: TokenInfo): boolean {
    return Date.now() >= token.expiresAt - EXPIRY_BUFFER_MS;
  }
}
