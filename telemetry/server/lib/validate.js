// @ts-check
import { weeksAgo } from "./week.js";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_WEEKS_OLD = 9;
export const ENVELOPE_KEYS = ["schema", "atlas_version", "os", "python", "week", "nonce", "counts"];
/** Schema 3 adds `partial` (required: true for a week-to-date snapshot) and `test` (optional, true only). */
export const V3_REQUIRED = ["partial"];
export const V3_OPTIONAL = ["test"];
/** A counter key the allowlist does not know is dropped (and counted), never stored. Its shape is still checked. */
const DROPPABLE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,95}$/; // same charset the allowlist uses (team.size.9+, dispatch.PreToolUse.*)
export const OS_VALUES = ["linux", "darwin", "windows", "other"];

const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,16})?$/;
const PYTHON_RE = /^3\.\d{1,2}$/;
const WEEK_FORMAT_RE = /^\d{4}-W\d{2}$/;
const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ERRORS = 20;

/**
 * @typedef {{schema: number, schemas?: number[], max_count: number, min_installs_published: number,
 *   keys: string[]}} AllowedKeys
 * @typedef {{schema: number, atlas_version: string, os: string, python: string, week: string,
 *   nonce: string, counts: Record<string, number>, partial?: boolean, test?: boolean,
 *   dropped?: number}} Submission
 * @typedef {{ok: boolean, errors: string[], value?: Submission}} ValidationResult
 */

/** @type {WeakMap<AllowedKeys, Set<string>>} */
const keySets = new WeakMap();

/**
 * @param {AllowedKeys} allowed
 * @returns {Set<string>}
 */
function keySet(allowed) {
  let s = keySets.get(allowed);
  if (!s) {
    s = new Set(allowed.keys);
    keySets.set(allowed, s);
  }
  return s;
}

/**
 * Validate a raw submission body. Pure: no I/O. Counter keys outside the allowlist are dropped and
 * counted in `dropped` instead of failing the payload: one key added by a newer client must never cost
 * the whole week (that is how every 17.16+ install lost its data against the Nov 5 server).
 * @param {string | Uint8Array} body raw request body
 * @param {AllowedKeys} allowed contents of telemetry/allowed-keys.json
 * @param {Date} [now]
 * @returns {ValidationResult}
 */
export function validateSubmission(body, allowed, now = new Date()) {
  /** @type {string[]} */
  const errors = [];
  const fail = (/** @type {string} */ msg) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  const size = typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
  if (size > MAX_BODY_BYTES) return { ok: false, errors: [`body larger than ${MAX_BODY_BYTES} bytes`] };

  let data;
  try {
    data = JSON.parse(typeof body === "string" ? body : new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { ok: false, errors: ["body is not valid JSON"] };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }

  const schemas = allowed.schemas ?? [allowed.schema];
  if (!schemas.includes(data.schema)) return { ok: false, errors: [`schema must be one of ${schemas.join(", ")}`] };
  const v3 = data.schema >= 3;
  const required = v3 ? [...ENVELOPE_KEYS, ...V3_REQUIRED] : ENVELOPE_KEYS;
  const permitted = v3 ? [...required, ...V3_OPTIONAL] : required;
  const keys = Object.keys(data);
  for (const k of keys) if (!permitted.includes(k)) fail(`unexpected envelope key: ${safe(k)}`);
  for (const k of required) if (!keys.includes(k)) fail(`missing envelope key: ${k}`);
  if (errors.length) return { ok: false, errors };

  if (v3 && typeof data.partial !== "boolean") fail("partial must be true or false");
  if (v3 && "test" in data && data.test !== true) fail("test, when present, must be true");
  if (typeof data.atlas_version !== "string" || !SEMVER_RE.test(data.atlas_version)) {
    fail("atlas_version must be a semver string");
  }
  if (typeof data.os !== "string" || !OS_VALUES.includes(data.os)) {
    fail(`os must be one of ${OS_VALUES.join(", ")}`);
  }
  if (typeof data.python !== "string" || !PYTHON_RE.test(data.python)) fail("python must look like 3.12");
  if (typeof data.nonce !== "string" || !UUID4_RE.test(data.nonce)) fail("nonce must be a lowercase UUIDv4");

  if (typeof data.week !== "string" || !WEEK_FORMAT_RE.test(data.week)) {
    fail("week must look like 2026-W44");
  } else {
    const ago = weeksAgo(data.week, now);
    if (ago === null) fail("week is not a real ISO week");
    else if (ago < 0) fail("week is in the future");
    else if (ago > MAX_WEEKS_OLD) fail(`week is older than ${MAX_WEEKS_OLD} weeks`);
  }

  const counts = data.counts;
  /** @type {[string, number][]} */
  const kept = [];
  let dropped = 0;
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    fail("counts must be an object");
  } else {
    const entries = Object.entries(counts);
    if (entries.length === 0) fail("counts must not be empty");
    const allowedSet = keySet(allowed);
    for (const [k, v] of entries) {
      if (!allowedSet.has(k) && !DROPPABLE_KEY_RE.test(k)) fail(`counts key malformed: ${safe(k)}`);
      else if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > allowed.max_count) {
        fail(`count out of range 1..${allowed.max_count}: ${safe(k)}`);
      } else if (allowedSet.has(k)) kept.push([k, v]);
      else dropped += 1;
    }
  }

  if (errors.length) return { ok: false, errors };
  /** @type {Submission} */
  const value = {
    schema: data.schema,
    atlas_version: data.atlas_version,
    os: data.os,
    python: data.python,
    week: data.week,
    nonce: data.nonce,
    counts: Object.fromEntries(kept.sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  if (v3) value.partial = data.partial;
  if (data.test === true) value.test = true;
  if (dropped) value.dropped = dropped;
  return { ok: true, errors: [], value };
}

/**
 * Keep echoed client strings short and printable.
 * @param {string} s
 * @returns {string}
 */
function safe(s) {
  return JSON.stringify(s.slice(0, 60));
}
