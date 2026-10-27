import type { IncomingMessage, ServerResponse } from "node:http";
import type { Provider } from "oidc-provider";
import type { AuditLogger } from "../audit.js";
import type { UpstreamKind } from "../config.js";
import { resolveRoles, type Policy } from "../policy.js";
import type { StorageAdapter } from "./adapter.js";
import { accountIdFor, type AccountStore } from "./accounts.js";
import { identityFromClaims } from "./identity.js";
import { newNonce, newPkceVerifier, newState, type UpstreamClient } from "./upstream.js";

export const UPSTREAM_LOGIN_MODEL = "UpstreamLogin";
const LOGIN_TTL_SECONDS = 600;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Single-use values of the ID token carry nothing the policy needs.
function snapshotClaims(claims: Record<string, unknown>): Record<string, unknown> {
  const { nonce: _n, at_hash: _a, c_hash: _c, ...rest } = claims;
  return rest;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface InteractionDeps {
  provider: Provider;
  baseUrl: string;
  upstream: UpstreamClient;
  upstreamKind: UpstreamKind;
  upstreamIssuer: string;
  logins: StorageAdapter;
  accounts: AccountStore;
  policy: Policy;
  audit: AuditLogger;
  // Extra group membership for the signed-in user (Google Cloud Identity).
  // A failure is logged and sign-in proceeds without those groups, so access
  // fails closed.
  lookupGroups?: (email: string) => Promise<string[]>;
}

interface LoginRecord extends Record<string, unknown> {
  uid: string;
  codeVerifier: string;
  nonce: string;
  status: "pending" | "done" | "error";
  accountId?: string;
  errorCode?: string;
}

function requestId(res: ServerResponse): string {
  return String(res.getHeader("X-Request-Id") ?? "");
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // No form-action: browsers apply it to the redirect chain after a form POST,
  // and the post-consent redirect goes to the client's own redirect URI.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
}

function page(res: ServerResponse, status: number, title: string, body: string): void {
  securityHeaders(res);
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}` +
      `button{font:inherit;padding:.5rem 1.25rem;margin-right:.5rem}dd{margin:0 0 .75rem 0}code{word-break:break-all}</style></head>` +
      `<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
  );
}

function expired(res: ServerResponse): void {
  page(res, 400, "Sign-in expired", "<p>This sign-in link is no longer valid. Return to your application and start again.</p>");
}

function redirect(res: ServerResponse, location: string): void {
  securityHeaders(res);
  res.writeHead(302, { Location: location });
  res.end();
}

async function drain(req: IncomingMessage): Promise<void> {
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) throw new Error("body too large");
  }
}

function originOk(req: IncomingMessage, baseUrl: string): boolean {
  const origin = req.headers.origin;
  return origin === undefined || origin === baseUrl;
}

export function renderConsent(opts: { uid: string; clientName: string; clientId: string; redirectHost: string; scopes: string[] }): string {
  const scopes = opts.scopes.length > 0 ? opts.scopes.map((s) => `<code>${escapeHtml(s)}</code>`).join(", ") : "<code>(none)</code>";
  const action = `/interaction/${encodeURIComponent(opts.uid)}`;
  return (
    `<p>An application is asking to access this MCP gateway on your behalf.</p>` +
    `<dl><dt>Application</dt><dd>${escapeHtml(opts.clientName)}</dd>` +
    `<dt>Client ID</dt><dd><code>${escapeHtml(opts.clientId)}</code></dd>` +
    `<dt>Returns you to</dt><dd><code>${escapeHtml(opts.redirectHost)}</code></dd>` +
    `<dt>Access requested</dt><dd>${scopes}</dd></dl>` +
    `<p>Only continue if you started this from that application.</p>` +
    `<form method="post" action="${escapeHtml(action)}/confirm" style="display:inline"><button type="submit">Allow</button></form>` +
    `<form method="post" action="${escapeHtml(action)}/abort" style="display:inline"><button type="submit">Cancel</button></form>`
  );
}

// Returns a handler for the /interaction/* routes: true when the request was
// handled, false when the path is not one of ours.
export function createInteractionHandler(deps: InteractionDeps): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { provider, baseUrl, audit } = deps;
  const callbackUri = `${baseUrl}/interaction/callback`;

  async function startLogin(req: IncomingMessage, res: ServerResponse, uid: string): Promise<void> {
    const state = newState();
    const record: LoginRecord = { uid, codeVerifier: newPkceVerifier(), nonce: newNonce(), status: "pending" };
    const url = await deps.upstream.authorizationUrl({
      redirectUri: callbackUri,
      state,
      nonce: record.nonce,
      codeVerifier: record.codeVerifier,
    });
    await deps.logins.upsert(state, record, LOGIN_TTL_SECONDS);
    redirect(res, url.toString());
  }

  async function showConsent(res: ServerResponse, uid: string, params: Record<string, unknown>, details: Record<string, unknown>): Promise<void> {
    const clientId = String(params.client_id ?? "");
    const client = await provider.Client.find(clientId);
    const redirectUri = String(params.redirect_uri ?? client?.redirectUris?.[0] ?? "");
    let redirectHost = "(unknown)";
    try {
      redirectHost = new URL(redirectUri).host || redirectHost;
    } catch {
      // keep the placeholder
    }
    const missing = (details.missingResourceScopes ?? {}) as Record<string, string[]>;
    const scopes = [...new Set([...((details.missingOIDCScope as string[] | undefined) ?? []), ...Object.values(missing).flat()])];
    page(
      res,
      200,
      "Authorize access",
      renderConsent({ uid, clientName: client?.clientName || clientId, clientId, redirectHost, scopes }),
    );
  }

  // Upstream redirects back here. Nothing is trusted until the state matches a
  // pending login; the interaction cookie is not sent to this path, so the
  // hand-off back into the interaction goes through /interaction/:uid/continue.
  async function handleCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const state = url.searchParams.get("state") ?? "";
    const stored = state ? await deps.logins.find(state) : undefined;
    if (!stored || stored.status !== "pending") {
      audit.emit({ request_id: requestId(res), event: "auth_failed", reason: "upstream_state_invalid" });
      expired(res);
      return;
    }
    const record = stored as LoginRecord;

    const fail = async (code: string): Promise<void> => {
      audit.emit({ request_id: requestId(res), event: "auth_failed", reason: code });
      await deps.logins.upsert(state, { ...record, status: "error", errorCode: code }, LOGIN_TTL_SECONDS);
      redirect(res, `/interaction/${encodeURIComponent(record.uid)}/continue?s=${encodeURIComponent(state)}`);
    };

    if (url.searchParams.has("error")) {
      await fail("upstream_denied");
      return;
    }

    let claims: Record<string, unknown>;
    try {
      claims = await deps.upstream.exchange({ callbackUrl: new URL(`${baseUrl}${req.url ?? ""}`), state, nonce: record.nonce, codeVerifier: record.codeVerifier });
    } catch {
      await fail("upstream_exchange_failed");
      return;
    }

    let groups: string[] = [];
    const email = typeof claims.email === "string" ? claims.email : undefined;
    if (deps.lookupGroups && email) {
      try {
        groups = await deps.lookupGroups(email);
      } catch (err) {
        console.error("[broker] groups lookup failed:", err instanceof Error ? err.message.slice(0, 200) : "error");
      }
    }

    const identity = identityFromClaims(deps.upstreamKind, claims, groups);
    if (!identity) {
      await fail("upstream_no_subject");
      return;
    }
    const roles = resolveRoles(deps.policy, identity.policyClaims);
    if (roles.length === 0) {
      await fail("no_roles");
      return;
    }

    const accountId = accountIdFor(deps.upstreamIssuer, identity.sub);
    await deps.accounts.upsert({
      accountId,
      issuer: deps.upstreamIssuer,
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      idp: deps.upstreamKind,
      tenant: identity.tenant,
      roles,
      policyClaims: snapshotClaims(identity.policyClaims),
    });
    await deps.logins.upsert(state, { ...record, status: "done", accountId }, LOGIN_TTL_SECONDS);
    redirect(res, `/interaction/${encodeURIComponent(record.uid)}/continue?s=${encodeURIComponent(state)}`);
  }

  // Back inside the browser's interaction (cookie present): bind the finished
  // upstream login to this interaction and hand it to oidc-provider.
  async function handleContinue(req: IncomingMessage, res: ServerResponse, uid: string, url: URL): Promise<void> {
    const state = url.searchParams.get("s") ?? "";
    const details = await provider.interactionDetails(req, res);
    const stored = state ? await deps.logins.find(state) : undefined;
    if (details.uid !== uid || !stored || stored.uid !== uid || stored.status === "pending") {
      expired(res);
      return;
    }
    // Single use.
    await deps.logins.destroy(state);
    if (stored.status === "done" && typeof stored.accountId === "string") {
      await provider.interactionFinished(req, res, { login: { accountId: stored.accountId, remember: false } }, { mergeWithLastSubmission: false });
      return;
    }
    await provider.interactionFinished(
      req,
      res,
      { error: "access_denied", error_description: "sign-in was not completed" },
      { mergeWithLastSubmission: false },
    );
  }

  async function handleConfirm(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const details = await provider.interactionDetails(req, res);
    if (details.prompt.name !== "consent" || !details.session?.accountId) {
      expired(res);
      return;
    }
    const { prompt, params } = details;
    let grant = details.grantId ? await provider.Grant.find(details.grantId) : undefined;
    if (!grant) grant = new provider.Grant({ accountId: details.session.accountId, clientId: String(params.client_id) });

    const d = prompt.details as { missingOIDCScope?: string[]; missingOIDCClaims?: string[]; missingResourceScopes?: Record<string, string[]> };
    if (d.missingOIDCScope) grant.addOIDCScope(d.missingOIDCScope.join(" "));
    if (d.missingOIDCClaims) grant.addOIDCClaims(d.missingOIDCClaims);
    for (const [indicator, scopes] of Object.entries(d.missingResourceScopes ?? {})) {
      grant.addResourceScope(indicator, scopes.join(" "));
    }
    const grantId = await grant.save();
    const consent = details.grantId ? {} : { grantId };
    await provider.interactionFinished(req, res, { consent }, { mergeWithLastSubmission: true });
  }

  async function handleAbort(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await provider.interactionFinished(
      req,
      res,
      { error: "access_denied", error_description: "the user declined" },
      { mergeWithLastSubmission: false },
    );
  }

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/interaction/")) return false;
    const parts = url.pathname.split("/").slice(2);
    try {
      if (parts[0] === "callback" && parts.length === 1) {
        if (req.method !== "GET") return methodNotAllowed(res);
        await handleCallback(req, res, url);
        return true;
      }
      const uid = parts[0] ?? "";
      if (!UID_RE.test(uid)) {
        expired(res);
        return true;
      }
      const action = parts[1];
      if (parts.length === 1) {
        if (req.method !== "GET") return methodNotAllowed(res);
        const details = await provider.interactionDetails(req, res);
        if (details.uid !== uid) {
          expired(res);
          return true;
        }
        if (details.prompt.name === "login") await startLogin(req, res, uid);
        else if (details.prompt.name === "consent") await showConsent(res, uid, details.params, details.prompt.details);
        else page(res, 400, "Unsupported request", "<p>This request cannot be completed.</p>");
        return true;
      }
      if (parts.length === 2 && action === "continue") {
        if (req.method !== "GET") return methodNotAllowed(res);
        await handleContinue(req, res, uid, url);
        return true;
      }
      if (parts.length === 2 && (action === "confirm" || action === "abort")) {
        if (req.method !== "POST") return methodNotAllowed(res);
        if (!originOk(req, baseUrl)) {
          page(res, 403, "Request blocked", "<p>This form was submitted from another site.</p>");
          return true;
        }
        await drain(req);
        const details = await provider.interactionDetails(req, res);
        if (details.uid !== uid) {
          expired(res);
          return true;
        }
        await (action === "confirm" ? handleConfirm(req, res) : handleAbort(req, res));
        return true;
      }
      page(res, 404, "Not found", "<p>Nothing here.</p>");
      return true;
    } catch (err) {
      // SessionNotFound (cookie missing or interaction expired) and anything
      // unexpected both end in the same page; details go to stderr only.
      const name = err instanceof Error ? err.name : "Error";
      if (name !== "SessionNotFound") console.error("[broker] interaction error:", name);
      if (!res.headersSent) expired(res);
      return true;
    }
  };

  function methodNotAllowed(res: ServerResponse): true {
    page(res, 405, "Method not allowed", "<p>Use the sign-in flow from your application.</p>");
    return true;
  }
}
