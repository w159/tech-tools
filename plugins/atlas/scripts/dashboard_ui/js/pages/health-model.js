// Pure logic for the Health page.

/** Subsystem status -> StateDot raw state plus the plain word shown beside it. */
export function healthState(sub) {
  if (!sub || sub.measured === false)
    return { raw: "unknown", word: "Not measured" };
  switch (sub.status) {
    case "ok":
      return { raw: "done", word: "Healthy" };
    case "warn":
      return { raw: "input", word: "Warning" };
    case "fail":
      return { raw: "fail", word: "Failing" };
    default:
      return { raw: "unknown", word: "Unknown" };
  }
}

/** True when the sparkline has at least one bucket with a count. */
export function hasHistory(sub) {
  return (
    Array.isArray(sub && sub.history) &&
    sub.history.some((b) => (b.ok || 0) + (b.fail || 0) > 0)
  );
}

const SUCCESS_LABELS = {
  tool_calls_ok: "Tool calls that ran",
  dispatches_ok: "Subagent dispatches",
  findings_closed: "Findings closed",
};

export function successLabel(kind) {
  return SUCCESS_LABELS[kind] || String(kind || "").replace(/_/g, " ");
}

const FAILURE_LABELS = {
  tool_error: "Atlas script error",
  tool_error_unclassified: "Tool-use mistake",
  hook_error: "Hook error",
};

export function failureLabel(kind) {
  return FAILURE_LABELS[kind] || String(kind || "").replace(/_/g, " ");
}

/** Failing subsystems first, then warnings, then the rest in server order. */
export function sortSubsystems(subs) {
  const rank = { fail: 0, warn: 1 };
  return [...(subs || [])]
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) => (rank[a.s.status] ?? 2) - (rank[b.s.status] ?? 2) || a.i - b.i,
    )
    .map((x) => x.s);
}


const MAX_REMEASURE = 10;

/** Finding status -> Badge tone. */
export function findingTone(status) {
  if (status === "fixed") return "ok";
  if (status === "open" || status === "partial") return "needs";
  if (status === "refuted" || status === "regressed") return "fail";
  return "neutral";
}

/** Doctor findings that can be re-measured: open or partial, capped so one click stays quick. */
export function remeasurable(findings) {
  return (findings || [])
    .filter(
      (f) =>
        f.source === "doctor" &&
        /^doctor:\d+$/.test(f.id) &&
        (f.status === "open" || f.status === "partial"),
    )
    .slice(0, MAX_REMEASURE);
}

/** One plain sentence from a remeasure reply ({ok, state:{verdict,current,baseline}, next}). */
export function remeasureSentence(res) {
  const s = (res && res.state) || {};
  const verdict = String(s.verdict || "measured").replace(/_/g, " ");
  return res && res.next ? `${verdict}. ${res.next}` : `Verdict: ${verdict}.`;
}

/** Summarise a batch of remeasure outcomes: [{ok}] -> "3 re-measured, 1 failed". */
export function batchSummary(results) {
  const ok = results.filter((r) => r.ok).length;
  const bad = results.length - ok;
  return bad ? `${ok} re-measured, ${bad} failed` : `${ok} re-measured`;
}

/** Ordered "label: count" strings for the counts block, biggest first. */
export function countLine(counts) {
  return Object.entries(counts || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
}
