import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPrompt,
  collectDescendantIds,
  buildIssueMaps,
  deriveWaitState,
  selectReadyLeafIssues,
  summarizeEpicState,
} from "../codex_epic_runner.mjs";

function issue(overrides) {
  return {
    id: "issue-1",
    title: "Example issue",
    description: "",
    status: "open",
    priority: 2,
    issue_type: "task",
    created_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

test("collectDescendantIds walks nested epic children", () => {
  const issues = [
    issue({ id: "epic-root", issue_type: "epic" }),
    issue({ id: "epic-a", issue_type: "epic", parent: "epic-root" }),
    issue({ id: "task-a1", parent: "epic-a" }),
    issue({ id: "task-root", parent: "epic-root" }),
  ];

  const { childrenByParent } = buildIssueMaps(issues);
  const descendants = collectDescendantIds("epic-root", childrenByParent);

  assert.deepEqual([...descendants].sort(), ["epic-a", "task-a1", "task-root"]);
});

test("selectReadyLeafIssues excludes descendant epics and sorts by priority", () => {
  const issues = [
    issue({ id: "epic-root", issue_type: "epic" }),
    issue({ id: "epic-a", issue_type: "epic", parent: "epic-root", priority: 1 }),
    issue({ id: "task-root", parent: "epic-root", priority: 2, created_at: "2026-04-10T00:00:02Z" }),
    issue({ id: "task-a1", parent: "epic-a", priority: 1, created_at: "2026-04-10T00:00:01Z" }),
  ];
  const ready = [
    issue({ id: "epic-a", issue_type: "epic", parent: "epic-root", priority: 1 }),
    issue({ id: "task-root", parent: "epic-root", priority: 2, created_at: "2026-04-10T00:00:02Z" }),
    issue({ id: "task-a1", parent: "epic-a", priority: 1, created_at: "2026-04-10T00:00:01Z" }),
  ];

  const selected = selectReadyLeafIssues({
    epicId: "epic-root",
    allIssues: issues,
    readyIssues: ready,
  });

  assert.deepEqual(selected.map((entry) => entry.id), ["task-a1", "task-root"]);
});

test("summarizeEpicState separates ready, in-progress, and blocked descendants", () => {
  const issues = [
    issue({ id: "epic-root", issue_type: "epic" }),
    issue({ id: "task-ready", parent: "epic-root", priority: 1 }),
    issue({ id: "task-busy", parent: "epic-root", status: "in_progress", priority: 2 }),
    issue({ id: "task-blocked", parent: "epic-root", priority: 3 }),
  ];
  const ready = [issue({ id: "task-ready", parent: "epic-root", priority: 1 })];

  const summary = summarizeEpicState({
    epicId: "epic-root",
    allIssues: issues,
    readyIssues: ready,
  });

  assert.deepEqual(summary.ready.map((entry) => entry.id), ["task-ready"]);
  assert.deepEqual(summary.inProgress.map((entry) => entry.id), ["task-busy"]);
  assert.deepEqual(summary.blockedOrWaiting.map((entry) => entry.id), ["task-blocked"]);
});

test("buildPrompt includes issue close/block contract", () => {
  const prompt = buildPrompt({
    epic: issue({ id: "epic-root", title: "Parent epic", issue_type: "epic" }),
    issue: issue({
      id: "task-1",
      title: "Implement workflow",
      description: "Ship the workflow runner",
      acceptance_criteria: "The runner advances to the next bead after close.",
    }),
    promptAppend: "Keep the implementation small and inspectable.",
  });

  assert.match(prompt, /BEAD_CLOSED: task-1/);
  assert.match(prompt, /Keep the implementation small and inspectable\./);
  assert.match(prompt, /Acceptance criteria:/);
});

test("deriveWaitState reports complete when no actionable descendants remain", () => {
  const state = deriveWaitState({
    unfinished: [],
    inProgress: [],
    blockedOrWaiting: [],
  });

  assert.deepEqual(state, {
    state: "complete",
    reason: "all actionable descendant beads are closed",
  });
});

test("deriveWaitState reports blocked when open descendants are not ready", () => {
  const state = deriveWaitState({
    unfinished: [issue({ id: "task-blocked" })],
    inProgress: [],
    blockedOrWaiting: [issue({ id: "task-blocked" })],
  });

  assert.deepEqual(state, {
    state: "waiting_blocked",
    reason: "remaining descendant beads are blocked or otherwise not ready",
  });
});

test("deriveWaitState reports no-ready when another descendant is already in progress", () => {
  const state = deriveWaitState({
    unfinished: [issue({ id: "task-busy", status: "in_progress" })],
    inProgress: [issue({ id: "task-busy", status: "in_progress" })],
    blockedOrWaiting: [],
  });

  assert.deepEqual(state, {
    state: "waiting_no_ready",
    reason: "another descendant bead is already in progress",
  });
});
