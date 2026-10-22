import { test, expect } from "bun:test";
import { fixCommands, staleInstallCommand } from "./health-fix.js";

const subs = [{ id: "hooks", evidence: ["stale plugin install 11.0.0 is producing faults: run python3 /x/scripts/atlas_doctor.py --fix, then /reload-plugins"] }];

test("hook_crash from a stale install uses the doctor command", () => {
  expect(staleInstallCommand(subs)).toBe("python3 /x/scripts/atlas_doctor.py --fix");
  expect(fixCommands({ kind: "hook_crash", next: "x" }, subs)).toEqual(["python3 /x/scripts/atlas_doctor.py --fix"]);
});

test("ingest_stalled gives both backfill commands", () => {
  expect(fixCommands({ kind: "ingest_stalled" }, []).length).toBe(2);
});

test("command is pulled from next text, none when absent", () => {
  expect(fixCommands({ kind: "hook_crash", next: "or run: tail -n 5 ~/.atlas/hook-faults.jsonl" }, [])).toEqual(["tail -n 5 ~/.atlas/hook-faults.jsonl"]);
  expect(fixCommands({ kind: "x", next: "Read the sample." }, [])).toEqual([]);
});

test("non-stale hook_crash, null subs and missing row fall back safely", () => {
  expect(staleInstallCommand(null)).toBe(null);
  expect(staleInstallCommand([{ evidence: ["unrelated"] }, {}])).toBe(null);
  expect(fixCommands({ kind: "hook_crash", next: "run: tail -n 5 f" }, [{ evidence: ["x"] }])).toEqual(["tail -n 5 f"]);
  expect(fixCommands(undefined, undefined)).toEqual([]);
  expect(fixCommands({ kind: "chronicle_gap" }, [])).toHaveLength(2);
});

import { failureAction, failureTone } from "./health-fix.js";

test("tail is a diagnostic, not a fix", () => {
  const a = failureAction({ kind: "hook_crash", next: "run: tail -n 5 ~/.atlas/hook-faults.jsonl" }, []);
  expect(a).toMatchObject({ type: "copy", label: "Copy diagnostic command" });
  expect(failureAction({ kind: "ingest_stalled" }, []).label).toBe("Copy fix command");
});

test("finding_id opens Improve, session_id copies the id, none has no button", () => {
  expect(failureAction({ kind: "doctor_regression", finding_id: 7 }, [])).toEqual({ type: "link", label: "Open in Improve", target: "improve?finding=7" });
  expect(failureAction({ kind: "hook_burst_tripped", session_id: "abc" }, [])).toEqual({ type: "copy", label: "Copy session id", text: "abc" });
  expect(failureAction({ kind: "x", next: "Read the sample." }, [])).toEqual({ type: "none" });
});

test("stale omp install sample yields the upgrade command", () => {
  const f = { kind: "hook_crash", sample: "omp: atlas omp install is stale: /x missing; run: omp plugin upgrade atlas, then restart omp sessions started before the upgrade" };
  expect(fixCommands(f, [])).toEqual(["omp plugin upgrade atlas"]);
});

test("non-atlas-fault kinds are info even when active", () => {
  expect(failureTone({ kind: "tool_error_unclassified", state: "active" })).toBe("info");
  expect(failureTone({ kind: "hook_crash", state: "active" })).toBe("warn");
  expect(failureTone({ kind: "hook_crash", state: "historic" })).toBe("info");
});
