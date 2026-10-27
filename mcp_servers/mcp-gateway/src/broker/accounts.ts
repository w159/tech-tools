import { createHash } from "node:crypto";
import type { StorageAdapter } from "./adapter.js";

export const ACCOUNT_MODEL = "GatewayAccount";

// What the broker keeps about a signed-in user. Upstream tokens are never
// stored: they are used once to read the identity and dropped.
export interface AccountRecord {
  accountId: string;
  // Upstream issuer and subject the account was derived from.
  issuer: string;
  sub: string;
  email?: string;
  name?: string;
  // Label for audit: the upstream kind, or "assertion".
  idp: string;
  tenant?: string;
  // Gateway roles resolved at the last sign-in.
  roles: string[];
  // Claims the policy was evaluated against at sign-in. A refresh re-evaluates
  // the policy on these with only the live-checked parts (roles, groups)
  // replaced, so it sees the same email, tenant and other claims as sign-in.
  policyClaims?: Record<string, unknown>;
}

// Stable and opaque: the same upstream (issuer, sub) always maps to the same
// account, whichever sign-in path produced it.
export function accountIdFor(issuer: string, sub: string): string {
  return `a_${createHash("sha256").update(`${issuer}|${sub}`).digest("base64url").slice(0, 32)}`;
}

export class AccountStore {
  constructor(private readonly adapter: StorageAdapter) {}

  async upsert(rec: AccountRecord): Promise<void> {
    await this.adapter.upsert(rec.accountId, { ...rec });
  }

  async find(accountId: string): Promise<AccountRecord | undefined> {
    const p = await this.adapter.find(accountId);
    return p ? (p as unknown as AccountRecord) : undefined;
  }
}
