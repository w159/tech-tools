// @ts-check
import allowedKeys from "../../allowed-keys.json" with { type: "json" };
import { checkToken, json } from "../lib/http.js";
import { createStore } from "../lib/store.js";
import { buildSummary } from "../lib/summary.js";
import { recentWeeks } from "../lib/window.js";

/** @typedef {import("../lib/store.js").Store} Store */

const DEFAULT_WEEKS = 10;
const MAX_WEEKS = 26;

/**
 * Behind ATLAS_DASHBOARD_TOKEN (Authorization: Bearer <token>).
 * GET    ?weeks=N&include_test=1  -> the full JSON summary the dashboard draws (and Claude reads).
 * DELETE ?purge=test             -> removes every submission marked test:true in the window.
 * @param {Request} request
 * @param {{store?: Store, allowed?: import("../lib/validate.js").AllowedKeys, now?: Date,
 *   env?: Record<string, string | undefined>}} [ctx]
 */
export async function handle(request, ctx = {}) {
  if (request.method !== "GET" && request.method !== "DELETE") {
    return json(405, { error: "method not allowed" }, { allow: "GET, DELETE" });
  }
  const auth = checkToken(request, ctx.env ?? process.env);
  if (auth === "unset") return json(503, { error: "dashboard secret ATLAS_DASHBOARD_TOKEN is not set" });
  if (auth === "denied") return json(401, { error: "wrong or missing token" }, { "www-authenticate": "Bearer" });

  const url = new URL(request.url, "http://localhost");
  const n = Math.min(MAX_WEEKS, Math.max(1, Number(url.searchParams.get("weeks")) || DEFAULT_WEEKS));
  const weeks = recentWeeks(ctx.now ?? new Date(), n);
  const allowed = ctx.allowed ?? allowedKeys;
  const store = ctx.store ?? (ctx.store = createStore());
  try {
    if (request.method === "DELETE") {
      if (url.searchParams.get("purge") !== "test") return json(400, { error: "only ?purge=test is supported" });
      let deleted = 0;
      for (const w of weeks) {
        for (const s of /** @type {import("../lib/validate.js").Submission[]} */ (await store.list(w))) {
          if (!s.test) continue;
          // The list may be stale: re-read right before deleting and only remove a row that is still test.
          const cur = await store.get(w, s.nonce);
          const now = /** @type {{test?: boolean} | undefined} */ (cur?.value);
          if (now?.test === true && (await store.del(w, s.nonce))) deleted += 1;
        }
      }
      return json(200, { ok: true, deleted });
    }
    const data = [];
    for (const w of weeks) {
      data.push({ week: w, submissions: /** @type {import("../lib/validate.js").Submission[]} */ (await store.list(w)) });
    }
    const includeTest = url.searchParams.get("include_test") === "1";
    return json(200, buildSummary(data, allowed, { includeTest, generatedAt: (ctx.now ?? new Date()).toISOString() }));
  } catch {
    return json(500, { error: "storage error" });
  }
}

/** @type {{fetch(request: Request): Promise<Response>}} */
export default { fetch: (request) => handle(request) };
