// @ts-check
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [extra]
 */
export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

/** @param {string} s */
const digest = (s) => createHash("sha256").update(s, "utf8").digest();

/**
 * The dashboard secret, accepted only as Authorization: Bearer <secret> (a query-string token would
 * land in access logs, browser history and Referer headers).
 * "unset" when ATLAS_DASHBOARD_TOKEN is missing or too short to be a real secret.
 * @param {Request} request
 * @param {Record<string, string | undefined>} env
 * @returns {"ok" | "denied" | "unset"}
 */
export function checkToken(request, env) {
  const want = env.ATLAS_DASHBOARD_TOKEN ?? "";
  if (want.length < 24) return "unset";
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!given) return "denied";
  // Compare fixed-length digests so neither length nor content leaks through timing.
  return timingSafeEqual(digest(given), digest(want)) ? "ok" : "denied";
}

/**
 * sha256 of the sorted allowlist, so a client or CI can tell whether the deployed server is current.
 * @param {string[]} keys
 */
export function allowlistHash(keys) {
  return createHash("sha256").update([...keys].sort().join("\n"), "utf8").digest("hex");
}
