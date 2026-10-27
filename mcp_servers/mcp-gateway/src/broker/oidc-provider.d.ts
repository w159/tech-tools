// oidc-provider 9.x ships no type definitions and no @types package is a
// dependency of this project. This shim declares only the surface the broker
// uses; everything else is intentionally loosely typed.
declare module "oidc-provider" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export interface ProviderCtx {
    oidc: {
      client: { clientId: string; grantTypeAllowed(type: string): boolean; [k: string]: unknown };
      params: Record<string, unknown>;
      entity(name: string, value: unknown): void;
      [k: string]: unknown;
    };
    body?: unknown;
    res: ServerResponse;
    [k: string]: unknown;
  }

  export interface InteractionDetails {
    uid: string;
    prompt: { name: string; reasons: string[]; details: Record<string, unknown> };
    params: Record<string, unknown>;
    session?: { accountId?: string };
    grantId?: string;
    [k: string]: unknown;
  }

  export interface GrantInstance {
    jti: string;
    addOIDCScope(scope: string): void;
    addOIDCClaims(claims: string[]): void;
    addResourceScope(indicator: string, scope: string): void;
    save(): Promise<string>;
  }

  export class Provider {
    constructor(issuer: string, configuration: Record<string, unknown>);
    proxy: boolean;
    Grant: { new (props: { accountId: string; clientId: string }): GrantInstance; find(id: string): Promise<GrantInstance | undefined> };
    Client: { find(id: string): Promise<{ clientId: string; clientName?: string; redirectUris?: string[] } | undefined> };
    AccessToken: new (props: Record<string, unknown>) => {
      scope?: string;
      resourceServer?: unknown;
      expiration: number;
      tokenType: string;
      accountId?: string;
      clientId?: string;
      gty?: string;
      save(): Promise<string>;
    };
    ResourceServer: new (identifier: string, data: Record<string, unknown>) => unknown;
    callback(): (req: IncomingMessage, res: ServerResponse) => void;
    interactionDetails(req: IncomingMessage, res: ServerResponse): Promise<InteractionDetails>;
    interactionFinished(
      req: IncomingMessage,
      res: ServerResponse,
      result: Record<string, unknown>,
      opts?: { mergeWithLastSubmission?: boolean },
    ): Promise<void>;
    registerGrantType(
      name: string,
      handler: (ctx: ProviderCtx) => Promise<void>,
      params?: string[],
      dupes?: string[],
    ): void;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export const errors: {
    InvalidGrant: new (options?: unknown) => Error;
    InvalidTarget: new (description?: string, options?: unknown) => Error;
    InvalidScope: new (description?: string, scope?: string) => Error;
    InvalidRequest: new (detail?: string) => Error;
    InvalidClient: new (detail?: string) => Error;
    [k: string]: unknown;
  };

  export default Provider;
}

declare module "oidc-provider/lib/helpers/grants.js" {
  import type { Provider, ProviderCtx } from "oidc-provider";
  export function buildTokenResponse(provider: Provider, input: Record<string, unknown>): Record<string, unknown>;
}
