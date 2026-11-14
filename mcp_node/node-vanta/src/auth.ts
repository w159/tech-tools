import { AuthenticationError, ServiceError } from './errors.js';
import { resilientFetch } from './net.js';
import type { VantaToken } from './types/common.js';

export interface VantaAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope: string;
}

/**
 * Manages an OAuth2 client_credentials token for the Vanta REST API.
 *
 * Vanta specifics (verified against developer.vanta.com):
 *   - POST https://api.vanta.com/oauth/token
 *   - Content-Type: application/json (NOT form-encoded)
 *   - Body: { client_id, client_secret, scope, grant_type: "client_credentials" }
 *   - Response: { access_token, expires_in: 3600, token_type: "Bearer" }
 *   - Only ONE active token per app; minting rate-limited to 5 req/min — so
 *     we cache aggressively and refresh ~60s before expiry.
 */
export class VantaAuthManager {
  private token: VantaToken | null = null;
  private inflight: Promise<VantaToken> | null = null;
  private readonly safetyWindowMs = 60_000;

  constructor(private readonly config: VantaAuthConfig) {}

  /** Returns a valid access token, minting/refreshing as needed. */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - this.safetyWindowMs > now) {
      return this.token.accessToken;
    }
    if (this.inflight) {
      const t = await this.inflight;
      return t.accessToken;
    }
    this.inflight = this.mint().finally(() => {
      this.inflight = null;
    });
    const t = await this.inflight;
    return t.accessToken;
  }

  /** Force a fresh mint. Useful when a 401 comes back from a normal call. */
  async refresh(): Promise<string> {
    this.token = null;
    return this.getAccessToken();
  }

  private async mint(): Promise<VantaToken> {
    const body = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope,
      grant_type: 'client_credentials',
    };

    // Throws NetworkError ("cannot reach <host>: ...") when the token endpoint is down or hung.
    const response = await resilientFetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }, { idempotent: true }); // client_credentials grant is safe to repeat

    const rawText = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(
          `Vanta token mint failed: ${response.status}`,
          parsed
        );
      }
      throw new ServiceError(
        `Vanta token mint failed: HTTP ${response.status}`,
        response.status,
        parsed
      );
    }

    const obj = parsed as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (!obj.access_token) {
      throw new AuthenticationError('Vanta token response missing access_token', parsed);
    }
    const expiresInSec = obj.expires_in ?? 3600;
    const token: VantaToken = {
      accessToken: obj.access_token,
      tokenType: obj.token_type ?? 'Bearer',
      expiresAt: Date.now() + expiresInSec * 1000,
    };
    this.token = token;
    return token;
  }
}
