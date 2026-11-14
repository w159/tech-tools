// @ts-check
import allowedKeys from "../../allowed-keys.json" with { type: "json" };
import { createStore } from "../lib/store.js";
import { MAX_BODY_BYTES, validateSubmission } from "../lib/validate.js";

/** @typedef {import("../lib/store.js").Store} Store */

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

/**
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [extra]
 */
function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/**
 * Read at most `limit` bytes of the body; null when it is larger.
 * @param {Request} request
 * @param {number} limit
 * @returns {Promise<Uint8Array | null>}
 */
async function readLimited(request, limit) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Handle one submission. Only the validated body is stored: no IP, headers, user agent or
 * timestamps are read, and the body is never logged. 201 = new, 200 = snapshot updated,
 * 409 = already stored (schema 2), already final (schema 3) or a lost write race.
 * @param {Request} request
 * @param {{store?: Store, allowed?: import("../lib/validate.js").AllowedKeys, now?: Date}} [ctx]
 * @returns {Promise<Response>}
 */
export async function handle(request, ctx = {}) {
  if (request.method !== "POST") return json(405, { error: "method not allowed" }, { allow: "POST" });
  const raw = await readLimited(request, MAX_BODY_BYTES);
  if (raw === null) return json(413, { error: "body too large" });

  const result = validateSubmission(raw, ctx.allowed ?? allowedKeys, ctx.now ?? new Date());
  if (!result.ok || !result.value) return json(400, { errors: result.errors });

  const sub = result.value;
  const { week, nonce } = sub;
  const store = ctx.store ?? (ctx.store = createStore());
  const accepted = { ok: true, kept: Object.keys(sub.counts).length, dropped: sub.dropped ?? 0 };
  try {
    if (sub.schema < 3) {
      // Schema 2 sends a finished week once: create-only, a retry is a 409 the client treats as success.
      if (await store.has(week, nonce)) return json(409, { error: "nonce already stored" });
      const stored = await store.put(week, nonce, JSON.stringify(sub));
      if (!stored) return json(409, { error: "nonce already stored" });
      return json(201, accepted);
    }
    // Schema 3 sends week-to-date snapshots under one per-week nonce; the newest replaces the last.
    // Any stored row that is not a partial (schema 2 rows have no partial field) is final, and a
    // partial never replaces it. Replacing is conditional on the etag we read, so a final that lands
    // between our read and our write is not clobbered; the loser re-reads once and re-applies the rule.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prev = await store.get(week, nonce);
      if (!prev) {
        // Create-only: two first writes cannot clobber each other.
        if (await store.put(week, nonce, JSON.stringify(sub))) return json(201, accepted);
        continue;
      }
      const stored = /** @type {{partial?: boolean}} */ (prev.value);
      if (sub.partial && stored.partial !== true) return json(409, { error: "week already final" });
      if (await store.put(week, nonce, JSON.stringify(sub), { ifMatch: prev.etag })) return json(200, accepted);
    }
    return json(409, { error: "concurrent update, retry" });
  } catch {
    return json(500, { error: "storage error" });
  }
}

/** @type {{fetch(request: Request): Promise<Response>}} */
export default { fetch: (request) => handle(request) };
