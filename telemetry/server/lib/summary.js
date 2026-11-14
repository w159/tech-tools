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
 * The feature a key counts as *used*, or null. Narrower than featureOf: a hook is used when it decides
 * (hook.<name>.deny|ask|context, no reason segment: hook.<name>.ask.protected is the same event again),
 * so a hook that only faults or runs slow is failing, not used, and the same event is never summed twice.
 * @param {string} key
 * @returns {[string, string] | null}
 */
export function useOf(key) {
  const f = featureOf(key);
  if (!f || f[0] !== "hook") return f;
  const parts = key.split(".");
  return parts.length === 3 && ["deny", "ask", "context"].includes(parts[2]) ? f : null;
}

/** @param {number} part @param {number} whole */
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

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
  const installWeeks = all.length;
  /** @type {Record<string, {name: string, installs: number, total: number}[]>} */
  const features = {};
  /** @type {Record<string, string[]>} */
  const unused = {};
  /** @type {Record<string, Map<string, Tally>>} */
  const perFamily = {};
  for (const fam of FEATURE_FAMILIES) {
    /** @type {Map<string, Tally>} */
    const per = new Map();
    for (const s of all) {
      /** @type {Map<string, number>} */
      const inThis = new Map();
      for (const [k, n] of Object.entries(s.counts)) {
        const f = useOf(k);
        if (f && f[0] === fam) inThis.set(f[1], (inThis.get(f[1]) ?? 0) + n);
      }
      for (const [name, n] of inThis) add(per, name, n);
    }
    features[fam] = sortedEntries(per).map(([name, v]) => ({ name, ...v, pct: pct(v.installs, installWeeks) }));
    perFamily[fam] = per;
  }
  // A skill typed as a slash command is counted as command.<name>, one the model invoked as skill.<name>:
  // it is unused only when neither was reported.
  const usedSkill = (/** @type {string} */ name) => perFamily.skill.has(name) || perFamily.command.has(name);
  for (const fam of FEATURE_FAMILIES) {
    unused[fam] =
      fam === "skill" || fam === "command"
        ? cat[fam].filter((name) => !usedSkill(name))
        : cat[fam].filter((name) => !perFamily[fam].has(name));
  }

  const sessionsTotal = weekRows.reduce((a, w) => a + w.sessions, 0);
  const failures = sortedEntries(keys)
    .filter(([k]) => FAILURE_RES.some((re) => re.test(k)))
    .map(([key, v]) => ({
      key,
      ...v,
      pct: pct(v.installs, installWeeks),
      per_100_sessions: sessionsTotal ? Math.round((v.total / sessionsTotal) * 1000) / 10 : null,
    }));
  const rates = buildRates(keys);
  const signals = buildSignals({ failures, rates, unused, features, cat, installWeeks });

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
      sessions: sessionsTotal,
      distinct_keys_seen: keys.size,
      allowlist_keys: allowed.keys.length,
    },
    weeks: weekRows,
    features,
    unused,
    failures,
    rates,
    signals,
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
      "unused lists shipped features nobody in the window reported: candidates to fix discovery, merge or retire. A skill counts as used when reported as skill.X (the model invoked it) or command.X (typed as a slash command). A hook counts as used only when it decided (deny, ask or context): a hook that never decides is silent, which is normal for a guard, so read unused.hook as 'never intervened', not as dead code.",
      "pct = share of install-weeks that reported the key; per_100_sessions = total / sessions * 100.",
      "rates: gate block share of finishes, send failure share, failed or timed-out team runs, slow (>= 1 s) dispatches. signals turns them into what to fix or build next, each with its evidence.",
      "dropped_keys > 0 means clients send keys this server does not know: redeploy the server.",
      "failures lists faults, slow hooks, gate blocks, failed team or crew runs, mod errors and send failures.",
    ],
  };
}

/**
 * Whole-window rates a count alone cannot show.
 * @param {Map<string, Tally>} keys
 */
function buildRates(keys) {
  const total = (/** @type {RegExp} */ re) => [...keys].filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v.total, 0);
  const one = (/** @type {string} */ k) => keys.get(k)?.total ?? 0;
  const blocks = total(/^gate\.[a-z]\.block$/);
  const passes = one("gate.pass");
  const ok = total(/^delivery\.ok\./);
  const fail = total(/^delivery\.fail\./);
  const done = one("team.outcome.done");
  const failed = one("team.outcome.failed");
  const timeout = one("team.outcome.timeout");
  const dispatch = total(/^dispatch\.[A-Za-z]+\.ms\./);
  const slow = total(/^dispatch\.[A-Za-z]+\.ms\.ge1000$/);
  return {
    gate: { blocks, passes, block_pct: pct(blocks, blocks + passes) },
    delivery: { ok, fail, fail_pct: pct(fail, ok + fail) },
    team: { done, failed, timeout, fail_pct: pct(failed + timeout, done + failed + timeout) },
    dispatch: { total: dispatch, slow, slow_pct: pct(slow, dispatch) },
  };
}

/**
 * What to fix or build next, as short statements that each carry the numbers behind them. Rules are
 * deliberately plain so Claude reading the JSON can disagree with them.
 * @param {{failures: {key: string, installs: number, total: number, pct: number}[],
 *   rates: ReturnType<typeof buildRates>, unused: Record<string, string[]>,
 *   features: Record<string, {name: string, installs: number}[]>, cat: Record<string, string[]>, installWeeks: number}} d
 * @returns {{kind: string, title: string, evidence: string}[]}
 */
function buildSignals(d) {
  /** @type {{kind: string, title: string, evidence: string}[]} */
  const out = [];
  const gates = d.failures.filter((f) => /^gate\.[a-z]\.block$/.test(f.key));
  if (gates.length && d.rates.gate.blocks > 0) {
    const g = gates[0];
    out.push({
      kind: "gate_blocks",
      title: `The Stop gate blocks ${d.rates.gate.block_pct}% of finishes; check ${g.key} first: is it a false positive or unclear?`,
      evidence: `${g.key} ${g.total}x in ${g.installs} install-weeks; ${d.rates.gate.blocks} blocks vs ${d.rates.gate.passes} clean passes`,
    });
  }
  const faults = d.failures.filter((f) => /^hook\.[^.]+\.fault$/.test(f.key) || /^fault\./.test(f.key));
  if (faults.length) {
    const f = faults[0];
    out.push({
      kind: "hook_faults",
      title: `Fix the hook crashes: ${f.key} is the most frequent`,
      evidence: `${f.key} ${f.total}x in ${f.installs} install-weeks (${f.pct}% of install-weeks); ${faults.length} fault keys in all`,
    });
  }
  const slowHooks = d.failures.filter((f) => /^hook\.[^.]+\.slow$/.test(f.key));
  if (slowHooks.length || d.rates.dispatch.slow_pct >= 5) {
    out.push({
      kind: "slow_hooks",
      title: "Hook dispatch is slow on real machines",
      evidence: `${d.rates.dispatch.slow} of ${d.rates.dispatch.total} dispatches took 1 s or more (${d.rates.dispatch.slow_pct}%)${slowHooks[0] ? `; slowest reported: ${slowHooks[0].key}` : ""}`,
    });
  }
  if (d.rates.team.failed + d.rates.team.timeout > 0) {
    out.push({
      kind: "team_failures",
      title: `${d.rates.team.fail_pct}% of team runs failed or timed out`,
      evidence: `done ${d.rates.team.done}, failed ${d.rates.team.failed}, timeout ${d.rates.team.timeout}`,
    });
  }
  if (d.rates.delivery.fail > 0) {
    out.push({
      kind: "send_failures",
      title: `${d.rates.delivery.fail_pct}% of telemetry sends failed: submissions are being lost`,
      evidence: `delivery ok ${d.rates.delivery.ok}, fail ${d.rates.delivery.fail}; these are only reported by installs whose later send worked, so the real loss is higher`,
    });
  }
  for (const fam of ["skill", "command", "agent"]) {
    const n = d.cat[fam].length;
    const un = d.unused[fam].length;
    if (n && un / n >= 0.25 && d.installWeeks > 0) {
      out.push({
        kind: "unused_features",
        title: `${un} of ${n} shipped ${fam}s were never reported: merge, retire or fix discovery`,
        evidence: `${d.unused[fam].slice(0, 8).join(", ")}${un > 8 ? ", ..." : ""} over ${d.installWeeks} install-weeks`,
      });
    }
  }
  return out;
}
