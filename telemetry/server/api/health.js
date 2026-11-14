// @ts-check
import allowedKeys from "../../allowed-keys.json" with { type: "json" };
import { allowlistHash, json } from "../lib/http.js";
import { createStore } from "../lib/store.js";
import { recentWeeks } from "../lib/window.js";

/** @typedef {import("../lib/store.js").Store} Store */

/**
 * GET -> is the receiver up, which allowlist is deployed, is the dashboard secret set, and how many
 * submissions (and test submissions) the last two weeks hold. Counts only: no keys, no nonces.
 * @param {Request} request
 * @param {{store?: Store, allowed?: import("../lib/validate.js").AllowedKeys, now?: Date,
 *   env?: Record<string, string | undefined>}} [ctx]
 */
export async function handle(request, ctx = {}) {
  if (request.method !== "GET") return json(405, { error: "method not allowed" }, { allow: "GET" });
  const allowed = ctx.allowed ?? allowedKeys;
  const env = ctx.env ?? process.env;
  const store = ctx.store ?? (ctx.store = createStore());
  /** @type {Record<string, {submissions: number, test: number}>} */
  const weeks = {};
  let storage = "ok";
  try {
    for (const w of recentWeeks(ctx.now ?? new Date(), 2)) {
      const subs = /** @type {{test?: boolean}[]} */ (await store.list(w));
      weeks[w] = { submissions: subs.filter((s) => !s.test).length, test: subs.filter((s) => s.test).length };
    }
  } catch {
    storage = "error";
  }
  return json(200, {
    ok: storage === "ok",
    storage,
    schemas: allowed.schemas ?? [allowed.schema],
    allowlist: { keys: allowed.keys.length, sha256: allowlistHash(allowed.keys) },
    dashboard_configured: (env.ATLAS_DASHBOARD_TOKEN ?? "").length >= 24,
    weeks,
  }, { "cache-control": "public, s-maxage=60" });
}

/** @type {{fetch(request: Request): Promise<Response>}} */
export default { fetch: (request) => handle(request) };
