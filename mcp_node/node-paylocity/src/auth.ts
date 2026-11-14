import { AuthenticationError, ServiceError } from './errors.js';
import { resilientFetch } from './net.js';
import type { PaylocityToken } from './types/common.js';

export interface PaylocityAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope: string;
}

/**
 * Manages an OAuth2 client_credentials token for the Paylocity REST API.
 *
 * Paylocity specifics (verified against developer.paylocity.com):
 *   - POST https://api.paylocity.com/IdentityServer/connect/token
 *     (sandbox: https://apisandbox.paylocity.com/IdentityServer/connect/token)
 *   - Content-Type: application/x-www-form-urlencoded   <-- differs from Vanta
 *   - Body params: client_id, client_secret,
 *                  grant_type=client_credentials, scope=WebLinkAPI
 *   - Response: { access_token, expires_in: 3600, token_type: "Bearer" }
 *   - TTL: 1 hour. No refresh tokens — re-mint on expiry.
 */
export class PaylocityAuthManager {
  private token: PaylocityToken | null = null;
  private inflight: Promise<PaylocityToken> | null = null;
  private readonly safetyWindowMs = 60_000;

  constructor(private readonly config: PaylocityAuthConfig) {}

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

  async refresh(): Promise<string> {
    this.token = null;
    return this.getAccessToken();
  }

  private async mint(): Promise<PaylocityToken> {
    const body = new URLSearchParams();
    body.set('client_id', this.config.clientId);
    body.set('client_secret', this.config.clientSecret);
    body.set('grant_type', 'client_credentials');
    if (this.config.scope) body.set('scope', this.config.scope);

    // Throws NetworkError ("cannot reach <host>: ...") when the token endpoint is down or hung.
    const response = await resilientFetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
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
          `Paylocity token mint failed: ${response.status}`,
          parsed
        );
      }
      throw new ServiceError(
        `Paylocity token mint failed: HTTP ${response.status}`,
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
      throw new AuthenticationError(
        'Paylocity token response missing access_token',
        parsed
      );
    }
    const expiresInSec = obj.expires_in ?? 3600;
    const token: PaylocityToken = {
      accessToken: obj.access_token,
      tokenType: obj.token_type ?? 'Bearer',
      expiresAt: Date.now() + expiresInSec * 1000,
    };
    this.token = token;
    return token;
  }
}
