// @ts-check
import { weeksAgo } from "./week.js";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_WEEKS_OLD = 9;
export const ENVELOPE_KEYS = ["schema", "atlas_version", "os", "python", "week", "nonce", "counts"];
export const OS_VALUES = ["linux", "darwin", "windows", "other"];

const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,16})?$/;
const PYTHON_RE = /^3\.\d{1,2}$/;
const WEEK_FORMAT_RE = /^\d{4}-W\d{2}$/;
const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ERRORS = 20;

/**
 * @typedef {{schema: number, max_count: number, min_installs_published: number, keys: string[]}} AllowedKeys
 * @typedef {{schema: number, atlas_version: string, os: string, python: string, week: string,
 *   nonce: string, counts: Record<string, number>}} Submission
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
 * Validate a raw submission body. Pure: no I/O.
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

  const keys = Object.keys(data);
  for (const k of keys) if (!ENVELOPE_KEYS.includes(k)) fail(`unexpected envelope key: ${safe(k)}`);
  for (const k of ENVELOPE_KEYS) if (!keys.includes(k)) fail(`missing envelope key: ${k}`);
  if (errors.length) return { ok: false, errors };

  if (data.schema !== allowed.schema) fail(`schema must be ${allowed.schema}`);
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
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    fail("counts must be an object");
  } else {
    const entries = Object.entries(counts);
    if (entries.length === 0) fail("counts must not be empty");
    const allowedSet = keySet(allowed);
    for (const [k, v] of entries) {
      if (!allowedSet.has(k)) fail(`counts key not allowed: ${safe(k)}`);
      else if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > allowed.max_count) {
        fail(`count out of range 1..${allowed.max_count}: ${safe(k)}`);
      }
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
    counts: Object.fromEntries(Object.entries(data.counts).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
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
