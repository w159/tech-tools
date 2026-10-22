// Pure logic for the Overview page.
import { mergeAgents } from "../state.js";

// Where each KPI tile links (route, extra params). Unknown ids link nowhere.
const KPI_LINKS = {
  runs: { route: "activity", params: { kind: "run" } },
  dispatches: { route: "activity", params: { kind: "dispatch" } },
  silent_failures: { route: "health" },
  tool_errors: { route: "health" },
  findings_open: { route: "improve" },
  todos_blocked: { route: "board", params: { status: "blocked" } },
};

export function kpiLink(id) {
  return KPI_LINKS[id] || null;
}

/** Agents that are doing or waiting on something, needs-input first, capped at `max`. */
export function runningNow(agentsPayload, project, max = 8) {
  const order = { input: 0, working: 1 };
  return mergeAgents(agentsPayload, null)
    .filter((a) => a.state in order)
    .filter((a) => !project || project === "all" || a.project === project)
    .sort((a, b) => order[a.state] - order[b.state])
    .slice(0, max);
}

/** Agents waiting on a person (state input), for the Needs you panel. */
export function waitingAgents(agentsPayload, project) {
  return mergeAgents(agentsPayload, null).filter(
    (a) =>
      a.state === "input" &&
      (!project || project === "all" || a.project === project),
  );
}

/** "Waiting 6m" needs a duration string; the page passes relTime. */
export function runState(run) {
  return run && !run.ended ? "running" : (run && run.state) || "done";
}
