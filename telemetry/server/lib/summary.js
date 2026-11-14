// @ts-check
// The admin view of the data: every install-week, no publish threshold (the dashboard is behind a
// secret), never a nonce. Built for two readers: Jerry on the dashboard and Claude reading the JSON.

/**
 * @typedef {import("./validate.js").Submission} Submission
 * @typedef {{installs: number, total: number}} Tally
 */

/** Families whose second key segment names a shipped feature: used to list what is never used. */
export const FEATURE_FAMILIES = ["skill", "command", "agent", "hook", "mod"];

/** Keys that mean something went wrong, by pattern. */
const FAILURE_RES = [
  /^hook\.[^.]+\.(fault|slow)$/,
  /^fault\./,
  /^gate\.[a-z]\.block$/,
  /^team\.outcome\.(failed|timeout)$/,
  /^crew\.outcome\.(failed|timeout|killed)$/,
  /^crew\.check\.fail$/,
  /^mod\.error\./,
  /^delivery\.fail\./,
];

/**
 * The feature a key counts, or null. Most families name it in the second segment (skill.atlas-plan.x);
 * mod keys name it in the second and third (mod.open.dock, mod.command.atlas-cc), and mod.error.* is a failure, not a feature.
 * @param {string} key
 * @returns {[string, string] | null} [family, feature]
 */
export function featureOf(key) {
  const [fam, a, b] = key.split(".");
  if (!FEATURE_FAMILIES.includes(fam) || !a) return null;
  if (fam !== "mod") return [fam, a];
  return (a === "open" || a === "command") && b ? [fam, `${a}.${b}`] : null;
}

/**
 * @param {Map<string, Tally>} m
 * @param {string} k
 * @param {number} n
 */
function add(m, k, n) {
  const cur = m.get(k) ?? { installs: 0, total: 0 };
  cur.installs += 1;
  cur.total += n;
  m.set(k, cur);
}

/** @param {string[]} values */
function tally(values) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([, a], [, b]) => b - a));
}

/** @param {Map<string, Tally>} m */
const sortedEntries = (m) => [...m].sort(([ka, a], [kb, b]) => b.total - a.total || (ka < kb ? -1 : 1));

/**
 * Shipped feature names per family, read from the allowlist (which is expanded from shipped files).
 * @param {string[]} keys
 * @returns {Record<string, string[]>}
 */
export function catalog(keys) {
  /** @type {Record<string, Set<string>>} */
  const out = Object.fromEntries(FEATURE_FAMILIES.map((f) => [f, new Set()]));
  for (const k of keys) {
    const f = featureOf(k);
    if (f) out[f[0]].add(f[1]);
  }
  return Object.fromEntries(Object.entries(out).map(([f, s]) => [f, [...s].sort()]));
}

/**
 * @param {{week: string, submissions: Submission[]}[]} weeks oldest first
 * @param {{keys: string[], min_installs_published: number}} allowed
 * @param {{includeTest?: boolean, generatedAt?: string}} [opts]
 */
export function buildSummary(weeks, allowed, opts = {}) {
  const include = (/** @type {Submission} */ s) => opts.includeTest || !s.test;
  /** @type {Map<string, Tally>} */
  const keys = new Map();
  /** @type {Submission[]} */
  const all = [];
  let testCount = 0;
  let dropped = 0;
  const weekRows = weeks.map(({ week, submissions }) => {
    const subs = submissions.filter(include);
    testCount += submissions.filter((s) => s.test).length;
    /** @type {Map<string, Tally>} */
    const wk = new Map();
    let sessions = 0;
    /** @type {number[]} */
    const days = [];
    for (const s of subs) {
      all.push(s);
      dropped += s.dropped ?? 0;
      let d = 0;
      for (const [k, n] of Object.entries(s.counts)) {
        add(keys, k, n);
        add(wk, k, n);
        if (k.startsWith("session.")) sessions += n;
        if (k.startsWith("active.day.")) d += 1;
      }
      if (d) days.push(d);
    }
    return {
      week,
      submissions: subs.length,
      partial: subs.filter((s) => s.partial).length,
      sessions,
      active_days_avg: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
      top: sortedEntries(wk)
        .slice(0, 15)
        .map(([key, v]) => ({ key, ...v })),
    };
  });

  const cat = catalog(allowed.keys);
  /** @type {Record<string, {name: string, installs: number, total: number}[]>} */
  const features = {};
  /** @type {Record<string, string[]>} */
  const unused = {};
  for (const fam of FEATURE_FAMILIES) {
    /** @type {Map<string, Tally>} */
    const per = new Map();
    for (const s of all) {
      /** @type {Map<string, number>} */
      const inThis = new Map();
      for (const [k, n] of Object.entries(s.counts)) {
        const f = featureOf(k);
        if (f && f[0] === fam) inThis.set(f[1], (inThis.get(f[1]) ?? 0) + n);
      }
      for (const [name, n] of inThis) add(per, name, n);
    }
    features[fam] = sortedEntries(per).map(([name, v]) => ({ name, ...v }));
    unused[fam] = cat[fam].filter((name) => !per.has(name));
  }

  const failures = sortedEntries(keys)
    .filter(([k]) => FAILURE_RES.some((re) => re.test(k)))
    .map(([key, v]) => ({ key, ...v }));

  const harness = tally(
    all.flatMap((s) => Object.keys(s.counts).filter((k) => k.startsWith("session.")).map((k) => k.slice(8))),
  );

  return {
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    window: { from: weeks[0]?.week ?? null, to: weeks.at(-1)?.week ?? null },
    include_test: Boolean(opts.includeTest),
    totals: {
      submissions: all.length,
      test_submissions: testCount,
      dropped_keys: dropped,
      sessions: weekRows.reduce((a, w) => a + w.sessions, 0),
      distinct_keys_seen: keys.size,
      allowlist_keys: allowed.keys.length,
    },
    weeks: weekRows,
    features,
    unused,
    failures,
    versions: {
      atlas_version: tally(all.map((s) => s.atlas_version)),
      os: tally(all.map((s) => s.os)),
      python: tally(all.map((s) => s.python)),
      harness,
    },
    keys: Object.fromEntries(sortedEntries(keys)),
    reading_guide: [
      "One submission is one install-week. installs = install-weeks that reported a key; total = summed count.",
      "partial = week-to-date snapshot of the current week; it is replaced as the week goes on.",
      "unused lists shipped features nobody in the window reported: candidates to fix discovery, merge or retire.",
      "dropped_keys > 0 means clients send keys this server does not know: redeploy the server.",
      "failures lists faults, slow hooks, gate blocks, failed team or crew runs, mod errors and send failures.",
    ],
  };
}
