import { test, expect } from "bun:test";
import { chanInfo, channelOf, leadChannels, memberBoard, memberState, presenceWord, projectLabel, todoSummary } from "./chan-names.js";

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
  expect(memberState({ state: "parked" }, { state: "working" })).toBe("parked");
  expect(memberState({ parked: true }, { state: "input" })).toBe("parked");
});

test("chanInfo: a main channel keeps its full name as the alias; folder comes from the project path", () => {
  expect(chanInfo({ name: "demo@main", project: "/home/u/work/demo/", branch: "main" })).toEqual({
    full: "demo@main", alias: "demo@main", sub: false, parent: null, folder: "demo", branch: "main", project: "/home/u/work/demo/", lead: null,
  });
});

test("chanInfo: a subchannel's alias is the part after '<parent>/' and the lead is carried", () => {
  expect(chanInfo({ name: "demo@main/lead-9", parent: "demo@main", lead: "lead-9", project: "/w/demo" })).toEqual({
    full: "demo@main/lead-9", alias: "lead-9", sub: true, parent: "demo@main", folder: "demo", branch: "", project: "/w/demo", lead: "lead-9",
  });
});

test("chanInfo: with no project the folder is the name's part before '@'; no branch/lead default to empty/null", () => {
  expect(chanInfo({ name: "solo@dev" })).toMatchObject({ folder: "solo", branch: "", project: "", lead: null, parent: null });
  expect(chanInfo({ name: "nobranch" }).folder).toBe("nobranch");
  expect(chanInfo({ name: "x@y", project: "/" }).folder).toBe("x");
  expect(chanInfo({ name: "x@y", project: "///" }).folder).toBe("x");
  expect(chanInfo({ name: "x@y", project: "/a/b//" }).folder).toBe("b");
});

test("channelOf: prefers the lead subchannel over the main channel, matches by member name or pane id", () => {
  const main = { name: "demo@main", project: "/w/demo", members: [{ name: "a" }, { name: "b", pane_id: "p1" }] };
  const sub = { name: "demo@main/l1", parent: "demo@main", members: [{ name: "a" }] };
  const other = { name: "o@main", members: [{ name: "z" }] };
  expect(channelOf({ name: "a" }, [main, sub, other]).full).toBe("demo@main/l1");
  expect(channelOf({ name: "a" }, [sub, main]).full).toBe("demo@main/l1");
  expect(channelOf({ name: "b" }, [main, sub, other]).full).toBe("demo@main");
  expect(channelOf({ name: "nope", key: "p1" }, [other, main]).full).toBe("demo@main");
  expect(channelOf({ name: "nope", key: "p2" }, [main, sub, other])).toBe(null);
  expect(channelOf({ name: "nope", key: undefined }, [{ name: "q", members: [{ name: "m", pane_id: undefined }] }])).toBe(null);
  expect(channelOf({ name: "a" }, null)).toBe(null);
  expect(channelOf({ name: "a" }, [{ name: "memberless" }])).toBe(null);
});

test("projectLabel: the main channel's name for that project root, else the folder name", () => {
  const chans = [{ name: "demo@feat", project: "/w/demo" }, { name: "demo@feat/l1", parent: "demo@feat", project: "/w/demo" }, { name: "other@main", project: "/w/other" }];
  expect(projectLabel("/w/demo", chans)).toBe("demo@feat");
  expect(projectLabel("/w/other", chans)).toBe("other@main");
  expect(projectLabel("/w/new/", chans)).toBe("new");
  expect(projectLabel("/w/new", null)).toBe("new");
  expect(projectLabel("/w/demo", [{ name: "demo@feat/l1", parent: "demo@feat", project: "/w/demo" }])).toBe("demo");
  expect(projectLabel("", [])).toBe("");
  expect(projectLabel(undefined, undefined)).toBe("");
});

test("presenceWord: maps every known state, unknown or missing states read 'no pane'", () => {
  expect(["working", "input", "idle", "parked", "done", "fail", "unknown"].map(presenceWord)).toEqual(["running", "waiting for input", "idle", "parked", "exited", "failed", "no pane"]);
  expect(presenceWord("whatever")).toBe("no pane");
  expect(presenceWord(undefined)).toBe("no pane");
  expect(presenceWord("")).toBe("no pane");
  for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) expect(presenceWord(k)).toBe("no pane");
});

test("todoSummary: only non-zero buckets, in active/open/blocked/done order", () => {
  expect(todoSummary({ active: 0, open: 3, blocked: 0, done: 0 })).toBe("3 open");
  expect(todoSummary({ active: 2, open: 0, blocked: 1, done: 0 })).toBe("2 active, 1 blocked");
  expect(todoSummary({ active: 0, open: 0, blocked: 0, done: 4 })).toBe("4 done");
  expect(todoSummary({ active: 1, open: 2, blocked: 3, done: 4 })).toBe("1 active, 2 open, 3 blocked, 4 done");
  expect(todoSummary({ active: 0, open: 0, blocked: 0, done: 0 })).toBe("no todos");
});

test("memberState: the live pane record wins; otherwise the channel's state maps onto presence", () => {
  expect(memberState({ state: "working" }, null)).toBe("working");
  expect(memberState({ state: "idle" }, null)).toBe("idle");
  expect(memberState({ state: "done" }, null)).toBe("done");
  expect(memberState({ state: "weird" }, null)).toBe("unknown");
  expect(memberState({ state: "blocked" }, { state: "working" })).toBe("working");
  expect(memberState({ state: "working", parked: false }, { state: "idle" })).toBe("idle");
  expect(memberState({}, { state: "fail" })).toBe("fail");
});

test("memberBoard: with no items the server's owner counts are the fallback (blocked stays inside pending/in_progress)", () => {
  const meta = { members: [{ name: "x" }] };
  const row = memberBoard(meta, { owners: [{ owner: "x", counts: { pending: 3, in_progress: 2, completed: 5 } }] })[0];
  expect(row.counts).toEqual({ active: 2, open: 3, blocked: 0, done: 5 });
  expect(todoSummary(row.counts)).toBe("2 active, 3 open, 5 done");
  expect(memberBoard(meta, { owners: [{ owner: "x", counts: { pending: 3 } }] })[0].counts).toEqual({ active: 0, open: 3, blocked: 0, done: 0 });
  expect(memberBoard(meta, { owners: [{ owner: "x" }] })[0].counts).toEqual({ active: 0, open: 0, blocked: 0, done: 0 });
});

test("memberBoard: role, parent, pane and state fall back from the owner to the member to defaults", () => {
  const meta = { members: [{ name: "m1", kind: "lead", parent: "par", pane_id: "p9", state: "idle" }, { name: "m2" }, { name: "m3", kind: "tester", parent: "q" }] };
  const rows = memberBoard(meta, { owners: [{ owner: "m3", role: "implementer", parent: "own-par" }] });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  expect(by.m1).toMatchObject({ role: "lead", parent: "par", pane_id: "p9", state: "idle" });
  expect(by.m2).toMatchObject({ role: "subagent", parent: null, pane_id: null, state: null });
  expect(by.m3).toMatchObject({ role: "implementer", parent: "own-par" });
  expect(rows.map((r) => r.name)).toEqual(["m1", "m2", "m3"]);
});

test("memberBoard: an owner missing from the channel is appended with its role and parent", () => {
  const rows = memberBoard({ members: [{ name: "a" }] }, { owners: [{ owner: "gone", role: "tester", parent: "lead-x" }] });
  expect(rows.find((r) => r.name === "gone")).toMatchObject({ role: "tester", parent: "lead-x", pane_id: null, state: null });
});

test("memberBoard: last note accepts a string, text or body, defaults ts to 0, and a missing note is null", () => {
  const meta = { members: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }] };
  const rows = memberBoard(meta, { owners: [
    { owner: "a", last_note: { text: "t", ts: 5 } },
    { owner: "b", last_note: { body: "from body" } },
    { owner: "c", last_note: { ts: 7 } },
    { owner: "d", last_note: "bare" },
  ] });
  const by = Object.fromEntries(rows.map((r) => [r.name, r.note]));
  expect(by.a).toEqual({ text: "t", ts: 5 });
  expect(by.b).toEqual({ text: "from body", ts: 0 });
  expect(by.c).toEqual({ text: "", ts: 7 });
  expect(by.d).toEqual({ text: "bare", ts: 0 });
  expect(by.e).toBe(null);
});

test("memberBoard: the lead sorts first and the rest alphabetically; only the role 'lead' counts", () => {
  const meta = { members: [{ name: "zed", kind: "subagent" }, { name: "amy", kind: "subagent" }, { name: "boss", kind: "lead" }, { name: "bob", kind: "lead" }] };
  expect(memberBoard(meta, null).map((r) => r.name)).toEqual(["bob", "boss", "amy", "zed"]);
});

test("memberBoard: current is the first in_progress item's content, blank when none", () => {
  const meta = { members: [{ name: "a" }, { name: "b" }] };
  const rows = memberBoard(meta, { owners: [
    { owner: "a", items: [{ content: "first", status: "open" }, { content: "doing 1", status: "in_progress" }, { content: "doing 2", status: "in_progress" }] },
    { owner: "b", items: [{ content: "only open", status: "open" }] },
  ] });
  expect(rows[0].current).toBe("doing 1");
  expect(rows[1].current).toBe("");
});

test("leadChannels: empty or missing input gives an empty list", () => {
  expect(leadChannels(null)).toEqual([]);
  expect(leadChannels(undefined)).toEqual([]);
  expect(leadChannels([])).toEqual([]);
});
