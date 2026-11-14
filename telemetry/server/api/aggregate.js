// @ts-check
import allowedKeys from "../../allowed-keys.json" with { type: "json" };
import { aggregate } from "../lib/aggregate.js";
import { createStore } from "../lib/store.js";
import { WEEK_RE, lastFinishedWeek, weekStart } from "../lib/week.js";

/** @typedef {import("../lib/store.js").Store} Store */

/**
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [extra]
 */
function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

/**
 * GET ?week=YYYY-Www (default: last finished ISO week) -> thresholded aggregate JSON.
 * @param {Request} request
 * @param {{store?: Store, allowed?: import("../lib/validate.js").AllowedKeys, now?: Date}} [ctx]
 * @returns {Promise<Response>}
 */
export async function handle(request, ctx = {}) {
  if (request.method !== "GET") return json(405, { error: "method not allowed" }, { allow: "GET" });
  const url = new URL(request.url, "http://localhost");
  // The edge caches per full URL: any parameter other than week would bypass the cache.
  for (const name of url.searchParams.keys()) {
    if (name !== "week") return json(400, { error: "only the week parameter is supported" }, { "cache-control": "no-store" });
  }
  const week = url.searchParams.get("week") ?? lastFinishedWeek(ctx.now ?? new Date());
  if (!WEEK_RE.test(week) || weekStart(week) === null) {
    return json(400, { error: "week must be a real ISO week like 2026-W44" }, { "cache-control": "no-store" });
  }
  const allowed = ctx.allowed ?? allowedKeys;
  const store = ctx.store ?? (ctx.store = createStore());
  try {
    const all = /** @type {import("../lib/validate.js").Submission[]} */ (await store.list(week));
    const subs = all.filter((s) => !s.test); // test submissions never reach the public totals
    const body = aggregate(week, subs, allowed.min_installs_published);
    return json(200, body, { "cache-control": "public, max-age=3600" });
  } catch {
    return json(500, { error: "storage error" }, { "cache-control": "no-store" });
  }
}

/** @type {{fetch(request: Request): Promise<Response>}} */
export default { fetch: (request) => handle(request) };
