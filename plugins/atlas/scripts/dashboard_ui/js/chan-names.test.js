import { test, expect } from "bun:test";
import { chanInfo, leadChannels, memberBoard, memberState, todoSummary } from "./chan-names.js";

const META = { name: "demo@feature/x/lead-1", parent: "demo@feature/x", lead: "lead-1", members: [{ name: "sub-b", kind: "subagent", pane_id: "w1-p3", state: "working" }, { name: "sub-a", kind: "subagent" }, { name: "lead-1", kind: "lead" }] };
const BOARD = {
  owners: [
    { owner: "sub-a", role: "subagent", counts: { pending: 2, in_progress: 2, completed: 1 }, last_note: { text: "halfway", ts: 100 }, items: [{ content: "queued thing", status: "open" }, { content: "task for sub-a", status: "in_progress" }, { content: "shipped", status: "done" }, { content: "stuck (was open)", status: "blocked" }, { content: "stuck (was in_progress)", status: "blocked" }] },
    { owner: "ghost", role: "subagent", counts: { completed: 2 }, items: [] },
  ],
};

test("memberBoard: lead first, then by name; owners that left the channel are kept", () => {
  expect(memberBoard(META, BOARD).map((r) => r.name)).toEqual(["lead-1", "ghost", "sub-a", "sub-b"]);
});

test("memberBoard: counts, current item and last note come from the owner", () => {
  const a = memberBoard(META, BOARD).find((r) => r.name === "sub-a");
  expect(a.counts).toEqual({ active: 1, open: 1, blocked: 2, done: 1 });
  expect(Object.values(a.counts).reduce((s, n) => s + n, 0)).toBe(a.items.length);
  expect(a.current).toBe("task for sub-a");
  expect(a.note).toEqual({ text: "halfway", ts: 100 });
  expect(todoSummary(a.counts)).toBe("1 active, 1 open, 2 blocked, 1 done");
  expect(memberBoard(META, BOARD).find((r) => r.name === "ghost").counts).toEqual({ active: 0, open: 0, blocked: 0, done: 2 });
});

test("memberBoard: a member without a board owner is an honest empty row", () => {
  const b = memberBoard(META, BOARD).find((r) => r.name === "sub-b");
  expect(b).toMatchObject({ role: "subagent", pane_id: "w1-p3", current: "", note: null, items: [] });
  expect(todoSummary(b.counts)).toBe("no todos");
  expect(memberBoard(META, null).length).toBe(3);
  expect(memberBoard(null, null)).toEqual([]);
});

test("leadChannels / chanInfo / memberState", () => {
  expect(leadChannels([{ name: "m" }, META]).map((c) => c.name)).toEqual([META.name]);
  expect(chanInfo(META)).toMatchObject({ sub: true, alias: "lead-1", lead: "lead-1" });
  expect(memberState({ state: "blocked" }, null)).toBe("input");
  expect(memberState({ state: "working" }, { state: "idle" })).toBe("idle");
  expect(memberState({}, null)).toBe("unknown");
});
