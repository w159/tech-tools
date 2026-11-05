// @ts-check

/**
 * @typedef {import("./validate.js").Submission} Submission
 * @typedef {{week: string, submissions: number, atlas_version?: Record<string, number>,
 *   os?: Record<string, number>, python?: Record<string, number>,
 *   counts?: Record<string, {installs: number, total: number}>}} Aggregate
 */

/**
 * Count values of one dimension; buckets below `minInstalls` fold into "other", and "other" is
 * itself dropped if it stays below the threshold.
 * @param {string[]} values
 * @param {number} minInstalls
 * @returns {Record<string, number>}
 */
function bucket(values, minInstalls) {
  /** @type {Map<string, number>} */
  const tally = new Map();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  /** @type {Record<string, number>} */
  const out = {};
  let other = 0;
  for (const [v, n] of [...tally].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (n >= minInstalls && v !== "other") out[v] = n;
    else other += n;
  }
  if (other >= minInstalls) out.other = other;
  return out;
}

/**
 * Aggregate one week of validated submissions. One submission is one install-week.
 * @param {string} week
 * @param {Submission[]} submissions
 * @param {number} minInstalls
 * @returns {Aggregate}
 */
export function aggregate(week, submissions, minInstalls) {
  if (submissions.length < minInstalls) return { week, submissions: submissions.length };

  /** @type {Map<string, {installs: number, total: number}>} */
  const perKey = new Map();
  for (const s of submissions) {
    for (const [k, n] of Object.entries(s.counts)) {
      const cur = perKey.get(k) ?? { installs: 0, total: 0 };
      cur.installs += 1;
      cur.total += n;
      perKey.set(k, cur);
    }
  }
  /** @type {Record<string, {installs: number, total: number}>} */
  const counts = {};
  for (const [k, v] of [...perKey].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (v.installs >= minInstalls) counts[k] = v;
  }
  return {
    week,
    submissions: submissions.length,
    atlas_version: bucket(submissions.map((s) => s.atlas_version), minInstalls),
    os: bucket(submissions.map((s) => s.os), minInstalls),
    python: bucket(submissions.map((s) => s.python), minInstalls),
    counts,
  };
}
