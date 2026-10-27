// Bridges the on-disk refresh token to the NinjaOne SDK's tokenSupplier hook.
// Handles refresh-on-demand and persists rotated refresh tokens.

import { loadTokens, saveTokens, type StoredTokens } from "./token-store.js";
import { refreshAccessToken } from "./user-flow.js";

const EXPIRY_BUFFER_MS = 60 * 1000;

export class UserTokenManager {
  private cache: StoredTokens | null = null;
  private refreshing: Promise<StoredTokens> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly region: string,
  ) {}

  async getAccessToken(): Promise<string> {
    const tokens = await this.getValidTokens();
    return tokens.accessToken;
  }

  /** Caller invokes this after a fresh sign-in to update the cached pair. */
  // fallow-ignore-next-line unused-class-member -- called via ensureUserTokenManager() in index.ts
  setTokens(t: StoredTokens): void {
    this.cache = t;
  }

  private async getValidTokens(): Promise<StoredTokens> {
    if (!this.cache) {
      const loaded = await loadTokens();
      if (!loaded) {
        throw new Error(
          "Not signed in to NinjaOne. Call the `ninjaone_sign_in` tool to start the browser sign-in flow.",
        );
      }
      if (loaded.region !== this.region) {
        throw new Error(
          `Stored tokens are for region "${loaded.region}" but server is configured for "${this.region}". ` +
          `Call \`ninjaone_sign_out\` then \`ninjaone_sign_in\` to re-authenticate against the correct region.`,
        );
      }
      this.cache = loaded;
    }
    if (Date.now() < this.cache.expiresAt - EXPIRY_BUFFER_MS) {
      return this.cache;
    }
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh(this.cache).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(prev: StoredTokens): Promise<StoredTokens> {
    const refreshed = await refreshAccessToken({
      baseUrl: this.baseUrl,
      clientId: this.clientId,
      refreshToken: prev.refreshToken,
    });
    const next: StoredTokens = {
      accessToken: refreshed.accessToken,
      // NinjaOne may rotate the refresh token; preserve the new one if present.
      refreshToken: refreshed.refreshToken ?? prev.refreshToken,
      expiresAt: Date.now() + refreshed.expiresIn * 1000,
      scope: refreshed.scope ?? prev.scope,
      region: prev.region,
    };
    await saveTokens(next);
    this.cache = next;
    return next;
  }
}
