// NinjaOne user authorization_code w/ PKCE flow.
//
// Listens on http://127.0.0.1:53682/oauth/callback (the URI you register in
// your NinjaOne OAuth app). Opens the user's browser to authorize, then
// captures the code from the redirect and exchanges it for tokens.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL, URLSearchParams } from "node:url";
import { generatePkce, generateState } from "./pkce.js";
import { openInBrowser } from "./browser.js";
import { saveTokens, type StoredTokens } from "./token-store.js";

const CALLBACK_PORT = 53682;
const CALLBACK_PATH = "/oauth/callback";
export const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
export const DEFAULT_SCOPES = ["monitoring", "management", "control", "offline_access"];

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

export interface UserFlowOptions {
  baseUrl: string;
  clientId: string;
  region: string;
  scopes?: string[];
  /** Called once with the authorize URL so the caller can echo it back to the user. */
  onAuthorizeUrl?: (url: string) => void;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

function htmlResponse(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#222}
h1{font-size:20px}.ok{color:#0a7d2e}.err{color:#b00020}p{line-height:1.5}</style></head>
<body>${body}<p style="color:#888;font-size:13px;margin-top:32px">You can close this tab.</p></body></html>`;
}

export async function runUserFlow(opts: UserFlowOptions): Promise<StoredTokens> {
  const scopes = opts.scopes ?? DEFAULT_SCOPES;
  const pkce = generatePkce();
  const state = generateState();

  const authorizeUrl = `${opts.baseUrl}/ws/oauth/authorize?` + new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(" "),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
  }).toString();

  const codePromise = listenForCallback(state);
  opts.onAuthorizeUrl?.(authorizeUrl);
  openInBrowser(authorizeUrl);

  const code = await codePromise;

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: opts.clientId,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pkce.verifier,
  });

  const tokenUrl = `${opts.baseUrl}/ws/oauth/token`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token exchange failed (HTTP ${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as TokenResponse;
  if (!data.refresh_token) {
    throw new Error(
      "NinjaOne did not return a refresh_token. Confirm 'offline_access' is included in the requested scopes and approved in your NinjaOne app registration.",
    );
  }

  const tokens: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? scopes.join(" "),
    region: opts.region,
  };
  await saveTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(opts: {
  baseUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string; scope?: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
  });
  const resp = await fetch(`${opts.baseUrl}/ws/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Refresh failed (HTTP ${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token, // some servers rotate; preserve if present
    scope: data.scope,
  };
}

function listenForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null;
    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error(`OAuth flow timed out after ${FLOW_TIMEOUT_MS / 1000}s with no callback`));
    }, FLOW_TIMEOUT_MS);

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400).end();
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const params = url.searchParams;
      const error = params.get("error");
      const code = params.get("code");
      const state = params.get("state");

      const finish = (status: number, html: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        setTimeout(() => server?.close(), 100);
        clearTimeout(timeout);
      };

      if (error) {
        finish(400, htmlResponse("Sign-in failed",
          `<h1 class="err">Sign-in failed</h1><p>${escapeHtml(error)}: ${escapeHtml(params.get("error_description") ?? "")}</p>`));
        reject(new Error(`OAuth error: ${error} ${params.get("error_description") ?? ""}`));
        return;
      }
      if (!code) {
        finish(400, htmlResponse("Missing code", `<h1 class="err">Missing authorization code</h1>`));
        reject(new Error("OAuth callback missing 'code' parameter"));
        return;
      }
      if (state !== expectedState) {
        finish(400, htmlResponse("State mismatch", `<h1 class="err">State mismatch — possible CSRF.</h1>`));
        reject(new Error("OAuth callback state did not match expected value"));
        return;
      }
      finish(200, htmlResponse("Sign-in complete",
        `<h1 class="ok">Signed in to NinjaOne</h1><p>Return to Claude Desktop — the MCP server now has the tokens it needs.</p>`));
      resolve(code);
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(
        `Could not bind to ${REDIRECT_URI}: ${err.message}. ` +
        `Another process may be using port ${CALLBACK_PORT}. ` +
        `Free the port (lsof -i :${CALLBACK_PORT}) and try again.`,
      ));
    });

    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
