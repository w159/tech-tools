// Pure logic for the Improve page.

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
