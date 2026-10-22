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
