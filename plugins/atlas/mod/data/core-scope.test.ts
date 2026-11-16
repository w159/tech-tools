import { describe, expect, test } from "bun:test";
import { type CoreInput, coreModel } from "./core";

const SINCE = Date.parse("2026-11-16T10:00:00Z");
const rows = [
  { id: "old-1", status: "rejected", verified_at: "2026-09-01T00:00:00Z" },
  { id: "old-2", status: "needs-evidence", verified_at: "2026-10-01T00:00:00Z" },
  { id: "old-3", status: "verified", verified_at: "2026-10-02T00:00:00Z" },
  { id: "at", status: "rejected", verified_at: "2026-11-16T10:00:00Z" },
  { id: "new", status: "verified", verified_at: "2026-11-16T11:00:00Z" },
  { id: "undated", status: "rejected" },
];
const input = (since?: number): CoreInput => ({
  findings: JSON.stringify(rows),
  teams: [],
  matrix: "",
  logs: {},
  reports: [],
  todos: [],
  header: { ok: 0, total: 0 },
  openGates: 0,
  ...(since === undefined ? {} : { since }),
});

describe("coreModel since scope", () => {
  test("rows before since are not counted or listed", () => {
    const m = coreModel(input(SINCE));
    expect(m.verdicts.map((v) => v.id)).not.toContain("old-1");
    expect(m.verdicts.map((v) => v.id)).not.toContain("old-2");
    expect(m.ledger.pending).toBe(0);
  });
  test("a row at or after since is counted", () => {
    const m = coreModel(input(SINCE));
    expect(m.verdicts.map((v) => v.id).sort()).toEqual(["at", "new"]);
    expect(m.ledger).toMatchObject({ verified: 1, refuted: 1, pending: 0 });
  });
  test("no since keeps the lifetime counts", () => {
    const m = coreModel(input());
    expect(m.verdicts.length).toBe(6);
    expect(m.ledger).toMatchObject({ verified: 2, refuted: 3, pending: 1 });
  });
  test("an undated row is excluded only when since is given", () => {
    expect(coreModel(input(SINCE)).verdicts.map((v) => v.id)).not.toContain("undated");
    expect(coreModel(input()).verdicts.map((v) => v.id)).toContain("undated");
  });
  test("verifiedDone matches a done todo verified this session", () => {
    const m = coreModel({
      ...input(SINCE),
      todos: [{ id: "new", status: "completed", content: "x", evidence: "e" } as any],
    });
    expect(m.contract.verifiedDone.ok).toBe(1);
  });
});
